(function () {
  'use strict';

  var MAX_LOG_ROWS = 500;     // rows kept in the on-screen table
  var MAX_FIXES = 20000;      // fixes kept in memory for the track / CSV export
  var FIRST_FIX_ZOOM = 17;

  var $ = function (id) { return document.getElementById(id); };

  var els = {
    status: $('status'),
    pause: $('btn-pause'),
    follow: $('btn-follow'),
    awake: $('btn-awake'),
    exportCsv: $('btn-export'),
    clear: $('btn-clear'),
    latlon: $('r-latlon'),
    acc: $('r-acc'),
    alt: $('r-alt'),
    altacc: $('r-altacc'),
    speed: $('r-speed'),
    heading: $('r-heading'),
    age: $('r-age'),
    time: $('r-time'),
    count: $('r-count'),
    log: $('log'),
    logEmpty: $('log-empty')
  };

  var state = {
    watchId: null,
    paused: false,
    follow: true,
    fixes: [],
    last: null,
    wakeLock: null,
    wantAwake: false
  };

  // ---------- map ----------

  var map = L.map('map', { zoomControl: true }).setView([20, 0], 2);

  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
  }).addTo(map);

  var track = L.polyline([], { color: '#2f81f7', weight: 3, opacity: 0.6 }).addTo(map);
  var accCircle = null;
  var dot = null;

  // Any manual pan turns off follow mode so the map doesn't yank back.
  map.on('dragstart', function () { setFollow(false); });

  function updateMap(fix) {
    var ll = [fix.lat, fix.lon];
    if (!dot) {
      accCircle = L.circle(ll, {
        radius: fix.acc || 0,
        color: '#2f81f7', weight: 1, fillOpacity: 0.12, interactive: false
      }).addTo(map);
      dot = L.circleMarker(ll, {
        radius: 7, color: '#fff', weight: 2, fillColor: '#2f81f7', fillOpacity: 1
      }).addTo(map);
      map.setView(ll, FIRST_FIX_ZOOM);
    } else {
      dot.setLatLng(ll);
      accCircle.setLatLng(ll).setRadius(fix.acc || 0);
      if (state.follow) map.panTo(ll, { animate: true });
    }
    track.addLatLng(ll);
  }

  // ---------- formatting ----------

  function isNum(v) { return typeof v === 'number' && isFinite(v); }
  function fmt(v, digits) { return isNum(v) ? v.toFixed(digits) : '—'; }
  function sub(text) { return ' <span class="sub">' + text + '</span>'; }

  var CARDINALS = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE',
                   'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
  function cardinal(deg) { return CARDINALS[Math.round(deg / 22.5) % 16]; }

  function pad(n, w) { n = String(n); while (n.length < w) n = '0' + n; return n; }
  function clock(ms) {
    var d = new Date(ms);
    return pad(d.getHours(), 2) + ':' + pad(d.getMinutes(), 2) + ':' +
           pad(d.getSeconds(), 2) + '.' + pad(d.getMilliseconds(), 3).slice(0, 1);
  }

  function age(ms) {
    if (ms < 0) ms = 0;
    var s = ms / 1000;
    if (s < 60) return s.toFixed(1) + ' s';
    if (s < 3600) return Math.floor(s / 60) + 'm ' + pad(Math.floor(s % 60), 2) + 's';
    return Math.floor(s / 3600) + 'h ' + pad(Math.floor((s % 3600) / 60), 2) + 'm';
  }

  // ---------- status ----------

  function setStatus(stateName, text) {
    els.status.dataset.state = stateName;
    els.status.textContent = text;
  }

  // ---------- readout ----------

  function renderReadout(fix) {
    els.latlon.textContent = fix.lat.toFixed(7) + ', ' + fix.lon.toFixed(7);
    els.acc.innerHTML = fmt(fix.acc, 1) + ' m';
    els.alt.innerHTML = isNum(fix.alt)
      ? fix.alt.toFixed(1) + ' m' + sub((fix.alt * 3.28084).toFixed(0) + ' ft')
      : '—';
    els.altacc.innerHTML = isNum(fix.altAcc) ? fix.altAcc.toFixed(1) + ' m' : '—';
    els.speed.innerHTML = isNum(fix.speed)
      ? fix.speed.toFixed(2) + ' m/s' + sub((fix.speed * 2.236936).toFixed(1) + ' mph')
      : '—';
    els.heading.innerHTML = isNum(fix.heading)
      ? fix.heading.toFixed(0) + '°' + sub(cardinal(fix.heading))
      : '—';
    els.time.textContent = clock(fix.t);
    els.count.textContent = state.fixes.length;
    renderAge();
  }

  function renderAge() {
    if (!state.last) return;
    els.age.textContent = age(Date.now() - state.last.t);
  }

  setInterval(renderAge, 250);

  // ---------- log table ----------

  function td(text, isNull) {
    var c = document.createElement('td');
    c.textContent = text;
    if (isNull) c.className = 'null';
    return c;
  }

  function logRow(fix, prev) {
    var tr = document.createElement('tr');
    var dt = prev ? (fix.t - prev.t) / 1000 : null;
    tr.appendChild(td(clock(fix.t)));
    tr.appendChild(td(fmt(dt, 1), dt === null));
    tr.appendChild(td(fix.lat.toFixed(7)));
    tr.appendChild(td(fix.lon.toFixed(7)));
    tr.appendChild(td(fmt(fix.acc, 1), !isNum(fix.acc)));
    tr.appendChild(td(fmt(fix.alt, 1), !isNum(fix.alt)));
    tr.appendChild(td(fmt(fix.altAcc, 1), !isNum(fix.altAcc)));
    tr.appendChild(td(fmt(fix.speed, 2), !isNum(fix.speed)));
    tr.appendChild(td(fmt(fix.heading, 0), !isNum(fix.heading)));
    els.log.insertBefore(tr, els.log.firstChild);
    while (els.log.childElementCount > MAX_LOG_ROWS) {
      els.log.removeChild(els.log.lastChild);
    }
    els.logEmpty.hidden = true;
  }

  // ---------- geolocation ----------

  function onPosition(position) {
    var c = position.coords;
    var fix = {
      t: position.timestamp,
      lat: c.latitude,
      lon: c.longitude,
      acc: c.accuracy,
      alt: c.altitude,
      altAcc: c.altitudeAccuracy,
      speed: c.speed,
      // Heading is meaningless when stationary; browsers report NaN or null.
      heading: isNum(c.heading) ? c.heading : null
    };
    var prev = state.last;
    state.fixes.push(fix);
    if (state.fixes.length > MAX_FIXES) state.fixes.shift();
    state.last = fix;

    renderReadout(fix);
    logRow(fix, prev);
    updateMap(fix);
    setStatus('ok', 'tracking');
  }

  function onError(err) {
    var msg;
    switch (err.code) {
      case 1: msg = 'location permission denied'; break;
      case 2: msg = 'position unavailable'; break;
      case 3: msg = 'timed out waiting for a fix'; break;
      default: msg = err.message || 'unknown error';
    }
    // Permission denied ends the watch; the others are transient.
    if (err.code === 1) {
      stopWatch();
      setStatus('error', msg);
    } else {
      setStatus('waiting', msg + ', retrying…');
    }
  }

  function startWatch() {
    if (state.watchId !== null) return;
    state.watchId = navigator.geolocation.watchPosition(onPosition, onError, {
      enableHighAccuracy: true,
      maximumAge: 0        // never hand back a cached fix
    });
    setStatus('waiting', 'waiting for fix…');
  }

  function stopWatch() {
    if (state.watchId === null) return;
    navigator.geolocation.clearWatch(state.watchId);
    state.watchId = null;
  }

  // ---------- controls ----------

  function setFollow(on) {
    state.follow = on;
    els.follow.setAttribute('aria-pressed', String(on));
    if (on && state.last) map.panTo([state.last.lat, state.last.lon]);
  }

  els.follow.addEventListener('click', function () { setFollow(!state.follow); });

  els.pause.addEventListener('click', function () {
    state.paused = !state.paused;
    els.pause.setAttribute('aria-pressed', String(state.paused));
    els.pause.textContent = state.paused ? 'Resume' : 'Pause';
    if (state.paused) {
      stopWatch();
      setStatus('paused', 'paused');
    } else {
      startWatch();
    }
  });

  els.clear.addEventListener('click', function () {
    // Keep state.last so the readout and fix age stay live.
    state.fixes = [];
    track.setLatLngs([]);
    els.log.textContent = '';
    els.logEmpty.hidden = false;
    els.count.textContent = '0';
  });

  els.latlon.addEventListener('click', function () {
    if (!state.last || !navigator.clipboard) return;
    var text = state.last.lat.toFixed(7) + ',' + state.last.lon.toFixed(7);
    navigator.clipboard.writeText(text).then(function () {
      els.latlon.classList.add('copied');
      setTimeout(function () { els.latlon.classList.remove('copied'); }, 1200);
    });
  });

  els.exportCsv.addEventListener('click', function () {
    if (!state.fixes.length) return;
    var cols = ['t', 'lat', 'lon', 'acc', 'alt', 'altAcc', 'speed', 'heading'];
    var lines = ['time_iso,' + cols.join(',')];
    state.fixes.forEach(function (f) {
      lines.push(new Date(f.t).toISOString() + ',' + cols.map(function (k) {
        return f[k] === null || f[k] === undefined ? '' : f[k];
      }).join(','));
    });
    var blob = new Blob([lines.join('\n') + '\n'], { type: 'text/csv' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'whereami-' + new Date().toISOString().replace(/[:.]/g, '-') + '.csv';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
  });

  // Screen wake lock keeps a phone from sleeping (which stops GPS updates).
  if ('wakeLock' in navigator) {
    els.awake.hidden = false;

    var acquireWakeLock = function () {
      navigator.wakeLock.request('screen').then(function (lock) {
        state.wakeLock = lock;
        lock.addEventListener('release', function () {
          state.wakeLock = null;
          if (!state.wantAwake) els.awake.setAttribute('aria-pressed', 'false');
        });
        els.awake.setAttribute('aria-pressed', 'true');
      }).catch(function () {
        state.wantAwake = false;
        els.awake.setAttribute('aria-pressed', 'false');
      });
    };

    els.awake.addEventListener('click', function () {
      state.wantAwake = !state.wantAwake;
      if (state.wantAwake) {
        acquireWakeLock();
      } else {
        els.awake.setAttribute('aria-pressed', 'false');
        if (state.wakeLock) state.wakeLock.release();
      }
    });

    // The lock is dropped whenever the page is hidden; take it back on return.
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'visible' && state.wantAwake && !state.wakeLock) {
        acquireWakeLock();
      }
    });
  }

  // ---------- start ----------

  if (!window.isSecureContext) {
    setStatus('error', 'geolocation needs HTTPS');
  } else if (!('geolocation' in navigator)) {
    setStatus('error', 'geolocation not supported');
  } else {
    startWatch();
  }
})();
