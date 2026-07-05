(function () {
  'use strict';

  function handleMediaFallback() {
    document.querySelectorAll('.hero__photo').forEach(function (img) {
      img.addEventListener('error', function () {
        img.style.display = 'none';
      });
    });
  }

  var MIN_CONTRAST_RATIO = 5;

  function randomInt(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
  }

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  //  WCAG para contraste

  function hslToRgb(h, s, l) {
    s /= 100;
    l /= 100;
    var c = (1 - Math.abs(2 * l - 1)) * s;
    var x = c * (1 - Math.abs(((h / 60) % 2) - 1));
    var m = l - c / 2;
    var r = 0, g = 0, b = 0;

    if (h < 60)       { r = c; g = x; b = 0; }
    else if (h < 120) { r = x; g = c; b = 0; }
    else if (h < 180) { r = 0; g = c; b = x; }
    else if (h < 240) { r = 0; g = x; b = c; }
    else if (h < 300) { r = x; g = 0; b = c; }
    else              { r = c; g = 0; b = x; }

    return [
      Math.round((r + m) * 255),
      Math.round((g + m) * 255),
      Math.round((b + m) * 255)
    ];
  }

  function relativeLuminance(rgb) {
    var channels = rgb.map(function (value) {
      var srgb = value / 255;
      return srgb <= 0.03928 ? srgb / 12.92 : Math.pow((srgb + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
  }

  function contrastRatio(rgbA, rgbB) {
    var lumA = relativeLuminance(rgbA);
    var lumB = relativeLuminance(rgbB);
    var lighter = Math.max(lumA, lumB);
    var darker = Math.min(lumA, lumB);
    return (lighter + 0.05) / (darker + 0.05);
  }

  // Fondo animado en WebGL "wash"

  function cssColorToRgbFloat(colorStr) {
    if (!cssColorToRgbFloat._ctx) {
      cssColorToRgbFloat._ctx = document.createElement('canvas').getContext('2d');
    }
    var ctx = cssColorToRgbFloat._ctx;
    ctx.fillStyle = '#000000';
    ctx.fillStyle = colorStr;
    var normalized = ctx.fillStyle; // el navegador lo normaliza a "#rrggbb"
    var hex = normalized.replace('#', '');
    return [
      parseInt(hex.substring(0, 2), 16) / 255,
      parseInt(hex.substring(2, 4), 16) / 255,
      parseInt(hex.substring(4, 6), 16) / 255
    ];
  }

  function setupBackgroundCanvas() {
    var canvas = document.querySelector('.hero__bg-canvas');
    if (!canvas) {
      return null;
    }

    var gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
    if (!gl) {
      // Sin WebGL: el canvas queda transparente y se ve el background-color de siempre en el body. No rompe nada.
      return null;
    }

    var vertexSource =
      'attribute vec2 aPosition;' +
      'void main() {' +
      '  gl_Position = vec4(aPosition, 0.0, 1.0);' +
      '}';

    var fragmentSource =
      'precision mediump float;' +
      'uniform vec2 uResolution;' +
      'uniform float uTime;' +
      'uniform vec3 uColorA;' +
      'uniform vec3 uColorB;' +
      'void main() {' +
      '  vec2 uv = gl_FragCoord.xy / uResolution;' +
      '  float wave1 = sin(uv.x * 3.1 + uTime * 0.15) * 0.5 + 0.5;' +
      '  float wave2 = sin(uv.y * 2.3 - uTime * 0.10 + uv.x * 1.7) * 0.5 + 0.5;' +
      '  float mixAmount = clamp(wave1 * 0.6 + wave2 * 0.4, 0.0, 1.0);' +
      '  vec3 color = mix(uColorA, uColorB, mixAmount * 0.10);' +
      '  gl_FragColor = vec4(color, 1.0);' +
      '}';

    function compileShader(type, source) {
      var shader = gl.createShader(type);
      gl.shaderSource(shader, source);
      gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        gl.deleteShader(shader);
        return null;
      }
      return shader;
    }

    var vertexShader = compileShader(gl.VERTEX_SHADER, vertexSource);
    var fragmentShader = compileShader(gl.FRAGMENT_SHADER, fragmentSource);
    if (!vertexShader || !fragmentShader) {
      return null;
    }

    var program = gl.createProgram();
    gl.attachShader(program, vertexShader);
    gl.attachShader(program, fragmentShader);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      return null;
    }
    gl.useProgram(program);

    var positionBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]),
      gl.STATIC_DRAW
    );

    var aPosition = gl.getAttribLocation(program, 'aPosition');
    gl.enableVertexAttribArray(aPosition);
    gl.vertexAttribPointer(aPosition, 2, gl.FLOAT, false, 0, 0);

    var uResolution = gl.getUniformLocation(program, 'uResolution');
    var uTime = gl.getUniformLocation(program, 'uTime');
    var uColorA = gl.getUniformLocation(program, 'uColorA');
    var uColorB = gl.getUniformLocation(program, 'uColorB');

    var prefersReducedMotion = window.matchMedia &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    // Resolución reducida a propósito
    
    var pixelRatio = Math.min(window.devicePixelRatio || 1, 1.5) * 0.75;

    var currentA = [0, 0, 0];
    var currentB = [0, 0, 0];
    var targetA = [0, 0, 0];
    var targetB = [0, 0, 0];

    function resize() {
      var width = Math.max(1, Math.floor(canvas.clientWidth * pixelRatio));
      var height = Math.max(1, Math.floor(canvas.clientHeight * pixelRatio));
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
        gl.viewport(0, 0, width, height);
      }
    }

    function draw(time) {
      for (var i = 0; i < 3; i++) {
        currentA[i] += (targetA[i] - currentA[i]) * 0.08;
        currentB[i] += (targetB[i] - currentB[i]) * 0.08;
      }

      gl.uniform2f(uResolution, canvas.width, canvas.height);
      gl.uniform1f(uTime, prefersReducedMotion ? 0 : time * 0.001);
      gl.uniform3f(uColorA, currentA[0], currentA[1], currentA[2]);
      gl.uniform3f(uColorB, currentB[0], currentB[1], currentB[2]);
      gl.drawArrays(gl.TRIANGLES, 0, 6);
    }

    var rafId = null;

    function loop(time) {
      draw(time);
      rafId = window.requestAnimationFrame(loop);
    }

    function start() {
      if (rafId === null) {
        rafId = window.requestAnimationFrame(loop);
      }
    }

    function stop() {
      if (rafId !== null) {
        window.cancelAnimationFrame(rafId);
        rafId = null;
      }
    }

    window.addEventListener('resize', resize);
    document.addEventListener('visibilitychange', function () {
      if (document.hidden) {
        stop();
      } else {
        start();
      }
    });

    resize();
    draw(0);

    if (!prefersReducedMotion) {
      start();
    }

    return {
      setTargetColors: function (bgColorStr, accentColorStr) {
        targetA = cssColorToRgbFloat(bgColorStr);
        targetB = cssColorToRgbFloat(accentColorStr);

        if (!this._initialized) {
          currentA = targetA.slice();
          currentB = targetB.slice();
          this._initialized = true;
        }

        if (prefersReducedMotion) {
          draw(0);
        }
      }
    };
  }

  var backgroundCanvas = null;

  function applyColors(colors) {
    var root = document.documentElement;
    root.style.setProperty('--color-bg', colors.bg);
    root.style.setProperty('--color-text', colors.text);
    root.style.setProperty('--color-accent', colors.accent);

    var themeColorMeta = document.querySelector('meta[name="theme-color"]');
    if (themeColorMeta) {
      themeColorMeta.setAttribute('content', colors.bg);
    }

    if (backgroundCanvas) {
      backgroundCanvas.setTargetColors(colors.bg, colors.accent);
    }
  }

  function pickComplementaryPair() {
    var hue = randomInt(0, 359);
    var complementaryHue = (hue + 180) % 360;

    var bgSaturation = randomInt(20, 90);
    var bgLightness = randomInt(10, 40);

    var textSaturation = randomInt(0, 50);
    var textLightness = randomInt(82, 99);

    var accentSaturation = randomInt(50, 95);
    var accentLightness = randomInt(45, 78);

    // Garantiza contraste WCAG real > 5 entre texto y fondo: oscurece el fondo y aclara el texto de a un paso hasta superar el umbral.
    var attempts = 0;
    while (
      contrastRatio(
        hslToRgb(hue, bgSaturation, bgLightness),
        hslToRgb(complementaryHue, textSaturation, textLightness)
      ) <= MIN_CONTRAST_RATIO &&
      attempts < 60
    ) {
      bgLightness = clamp(bgLightness - 1, 4, 100);
      textLightness = clamp(textLightness + 1, 0, 99);
      attempts += 1;
    }

    return {
      bg: 'hsl(' + hue + ', ' + bgSaturation + '%, ' + bgLightness + '%)',
      text: 'hsl(' + complementaryHue + ', ' + textSaturation + '%, ' + textLightness + '%)',
      accent: 'hsl(' + complementaryHue + ', ' + accentSaturation + '%, ' + accentLightness + '%)'
    };
  }

  // Paleta blanco y negro

  function pickMonochromePair() {
    var isDark = Math.random() < 0.5;
    var bg = isDark ? 'hsl(0, 0%, 6%)' : 'hsl(0, 0%, 97%)';
    var fg = isDark ? 'hsl(0, 0%, 97%)' : 'hsl(0, 0%, 6%)';

    return { bg: bg, text: fg, accent: fg };
  }

  function pickPalette() {
    // Más o menos 1 de cada 10 clicks para volver al BYN (frase de ford)
    return randomInt(1, 10) === 1 ? pickMonochromePair() : pickComplementaryPair();
  }

  function setupColorSwitcher() {
    var button = document.getElementById('colorSwitcherButton');
    if (!button) {
      return;
    }

    // Sin persistencia para el "refresh" a la paleta original
    
    button.addEventListener('click', function () {
      var colors = pickPalette();
      applyColors(colors);
    });
  }

  //  Firma en consola :)
  
  function logSignature() {
    if (!window.console || !console.log) {
      return;
    }
    console.log(
      '%c MICA ZAYAS✌️ %c colour · code · design 🌈 ',
      'background:#005a6c;color:#fef8f2;font-weight:bold;padding:6px 10px;border-radius:6px 0 0 6px;font-family:sans-serif;',
      'background:#ff3167;color:#fef8f2;font-weight:bold;padding:6px 10px;border-radius:0 6px 6px 0;font-family:sans-serif;'
    );
    console.log(
      '%cHand-coded site, tailored colors.',
      'color:#fffff;font-family:sans-serif;font-size:12px;'
    );
  }

  function init() {
    logSignature();
    handleMediaFallback();
    backgroundCanvas = setupBackgroundCanvas();
    if (backgroundCanvas) {
      var rootStyles = getComputedStyle(document.documentElement);
      backgroundCanvas.setTargetColors(
        rootStyles.getPropertyValue('--color-bg').trim(),
        rootStyles.getPropertyValue('--color-accent').trim()
      );
    }
    setupColorSwitcher();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
