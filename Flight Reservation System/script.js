(function () {
  'use strict';

  /* ------------------------------------------------------------------
     Data
  ------------------------------------------------------------------ */
  var AIRLINE = 'Meridian Air';
  var AIRPORTS = [
    { code: 'JNB', city: 'Johannesburg', lat: -26.139, lon: 28.246, tz: 2 },
    { code: 'CPT', city: 'Cape Town', lat: -33.965, lon: 18.602, tz: 2 },
    { code: 'DUR', city: 'Durban', lat: -29.614, lon: 31.119, tz: 2 },
    { code: 'PLZ', city: 'Gqeberha', lat: -33.985, lon: 25.617, tz: 2 },
    { code: 'WDH', city: 'Windhoek', lat: -22.48, lon: 17.46, tz: 2 },
    { code: 'MRU', city: 'Mauritius', lat: -20.43, lon: 57.68, tz: 4 },
    { code: 'NBO', city: 'Nairobi', lat: -1.319, lon: 36.927, tz: 3 },
    { code: 'DXB', city: 'Dubai', lat: 25.253, lon: 55.364, tz: 4 },
    { code: 'LHR', city: 'London', lat: 51.47, lon: -0.4543, tz: 0 },
    { code: 'FRA', city: 'Frankfurt', lat: 50.033, lon: 8.571, tz: 1 },
    { code: 'JFK', city: 'New York', lat: 40.641, lon: -73.778, tz: -5 },
    { code: 'SIN', city: 'Singapore', lat: 1.36, lon: 103.99, tz: 8 }
  ];
  var BY_CODE = {};
  AIRPORTS.forEach(function (a) { BY_CODE[a.code] = a; });

  var HUBS = ['JNB', 'DXB', 'NBO', 'FRA'];
  var CABINS = {
    economy: { label: 'Economy', mult: 1 },
    business: { label: 'Business', mult: 2.6 }
  };
  var ROUTES = [['JNB', 'CPT'], ['JNB', 'DUR'], ['CPT', 'JNB'], ['JNB', 'LHR'], ['JNB', 'DXB'], ['CPT', 'LHR']];
  var STEPS = [['search', 'Search'], ['results', 'Flights'], ['seats', 'Seats'], ['passengers', 'Passengers'], ['review', 'Review']];
  var STORE_KEY = 'meridian-air-bookings-v1';

  // Aircraft layout: 3 business rows (2-2), economy rows 10 to 29 (3-3), no row 13.
  var ROWS = [];
  var n;
  for (n = 1; n <= 3; n++) ROWS.push({ n: n, cabin: 'business', left: ['A', 'C'], right: ['D', 'F'] });
  for (n = 10; n <= 29; n++) {
    if (n === 13) continue;
    ROWS.push({ n: n, cabin: 'economy', left: ['A', 'B', 'C'], right: ['D', 'E', 'F'] });
  }
  var EXIT_ROW = 20;
  var FEE_ROWS = [10, 11, 12, 20];
  var SEAT_FEE = 150;

  /* ------------------------------------------------------------------
     Helpers
  ------------------------------------------------------------------ */
  function $(sel, root) { return (root || document).querySelector(sel); }

  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function money(v) {
    return 'R ' + Math.round(v).toLocaleString('en-ZA').replace(/ /g, ' ');
  }

  function mod(x, m) { return ((x % m) + m) % m; }
  function pad(v) { return String(v).padStart(2, '0'); }

  function hashStr(s) {
    var h = 2166136261;
    for (var i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  }

  function rng(seed) {
    var a = hashStr(seed);
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function toISO(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function fromISO(s) { var p = s.split('-').map(Number); return new Date(p[0], p[1] - 1, p[2]); }
  function addDays(iso, k) { var d = fromISO(iso); d.setDate(d.getDate() + k); return toISO(d); }
  function today() { return toISO(new Date()); }
  function fmtDate(iso) {
    return fromISO(iso).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
  }
  function fmtTime(min) { var m = mod(min, 1440); return pad(Math.floor(m / 60)) + ':' + pad(m % 60); }
  function fmtDur(min) { return Math.floor(min / 60) + 'h ' + pad(min % 60) + 'm'; }

  function distanceKm(a, b) {
    var R = 6371;
    var rad = function (x) { return x * Math.PI / 180; };
    var dLat = rad(b.lat - a.lat);
    var dLon = rad(b.lon - a.lon);
    var h = Math.pow(Math.sin(dLat / 2), 2) + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.pow(Math.sin(dLon / 2), 2);
    return 2 * R * Math.asin(Math.sqrt(h));
  }

  /* ------------------------------------------------------------------
     Flights, seats and prices
  ------------------------------------------------------------------ */
  function generateFlights(from, to, date) {
    var A = BY_CODE[from];
    var B = BY_CODE[to];
    var km = distanceKm(A, B);
    var r = rng('flights|' + from + '|' + to + '|' + date);
    var slots = [5.5, 7, 8.5, 10.5, 12.5, 14.5, 16.5, 18.5, 20.5];
    var hubs = HUBS.filter(function (h) { return h !== from && h !== to; });
    var list = [];

    slots.forEach(function (slot, i) {
      var skip = r() < 0.18;
      var jitter = Math.floor(r() * 6) * 5;
      var stopRoll = r();
      var priceRoll = r();
      var numRoll = r();
      var hubRoll = r();
      var layRoll = r();
      if (skip && i >= 2) return;

      var depMin = Math.round(slot * 60) + jitter;
      var stops = km > 3500 && stopRoll < 0.45 ? 1 : 0;
      var dur = Math.round((km / 830 * 60 + 45) / 5) * 5;
      var via = null;
      if (stops) {
        dur += Math.round((100 + layRoll * 90 + dur * 0.1) / 5) * 5;
        via = hubs[Math.floor(hubRoll * hubs.length)];
      }

      var base = 780 + km * (km > 3000 ? 1.05 : 1.6);
      var peak = (depMin >= 360 && depMin <= 540) || (depMin >= 960 && depMin <= 1140) ? 1.12 : 1;
      var price = base * peak * (0.82 + priceRoll * 0.5) * (stops ? 0.86 : 1);
      price = Math.round(price / 10) * 10;

      var depUtc = depMin - A.tz * 60;
      var arrLocal = depUtc + dur + B.tz * 60;

      list.push({
        id: from + to + date + '-' + i,
        from: from,
        to: to,
        date: date,
        no: 'MA ' + (100 + Math.floor(numRoll * 880)),
        depMin: depMin,
        arrMin: mod(arrLocal, 1440),
        arrDay: Math.floor(arrLocal / 1440),
        dur: dur,
        stops: stops,
        via: via,
        price: price,
        km: Math.round(km),
        aircraft: km < 1800 ? 'Airbus A320' : km < 7000 ? 'Boeing 787-8' : 'Airbus A350-900'
      });
    });
    return list;
  }

  function seatRow(seat) { return parseInt(seat, 10); }
  function seatFee(seat) { return FEE_ROWS.indexOf(seatRow(seat)) >= 0 ? SEAT_FEE : 0; }

  var memoryBookings = [];

  function loadBookings() {
    try {
      var v = JSON.parse(localStorage.getItem(STORE_KEY) || '[]');
      if (Array.isArray(v)) memoryBookings = v;
    } catch (e) { /* storage unavailable, keep the in-memory list */ }
    return memoryBookings;
  }

  function saveBookings(list) {
    memoryBookings = list;
    try { localStorage.setItem(STORE_KEY, JSON.stringify(list)); } catch (e) { /* in-memory only */ }
  }

  function occupiedFor(flight) {
    var r = rng('occupied|' + flight.id);
    var set = {};
    ROWS.forEach(function (row) {
      row.left.concat(row.right).forEach(function (c) {
        if (r() < (row.cabin === 'business' ? 0.4 : 0.42)) set[row.n + c] = true;
      });
    });
    loadBookings().forEach(function (b) {
      if (b.status !== 'confirmed') return;
      b.legs.forEach(function (l, i) {
        if (l.id === flight.id) b.seats[i].forEach(function (s) { if (s) set[s] = true; });
      });
    });
    return set;
  }

  /* ------------------------------------------------------------------
     State
  ------------------------------------------------------------------ */
  var state = {
    view: 'search',
    reached: 0,
    search: { trip: 'return', from: 'JNB', to: 'CPT', depart: addDays(today(), 7), ret: addDays(today(), 14), pax: 1, cabin: 'economy' },
    legs: [],
    sort: 'price',
    nonstop: false,
    seats: [],
    seatLeg: 0,
    seatPax: 0,
    passengers: [{ first: '', last: '' }],
    contact: { email: '', phone: '' },
    errors: {},
    booking: null,
    manage: { pnr: '', last: '', error: '', booking: null, confirmCancel: false }
  };

  function legCount() { return state.search.trip === 'return' ? 2 : 1; }
  function fareFor(f) { return Math.round(f.price * CABINS[state.search.cabin].mult / 10) * 10; }

  function seatsComplete() {
    if (!state.legs.length || state.seats.length !== state.legs.length) return false;
    return state.seats.every(function (arr) {
      return arr.length === state.search.pax && arr.every(Boolean);
    });
  }

  function totals() {
    var pax = state.search.pax;
    var fares = 0, taxes = 0, seatFees = 0;
    state.legs.forEach(function (f, i) {
      var fare = fareFor(f);
      fares += fare * pax;
      taxes += (Math.round(fare * 0.12) + 150) * pax;
      (state.seats[i] || []).forEach(function (s) { if (s) seatFees += seatFee(s); });
    });
    return { fares: fares, taxes: taxes, seatFees: seatFees, total: fares + taxes + seatFees };
  }

  function autoAssign(legIdx) {
    var pax = state.search.pax;
    var occ = occupiedFor(state.legs[legIdx]);
    var rows = ROWS.filter(function (r) { return r.cabin === state.search.cabin; });
    var freeIn = function (row) {
      return row.left.concat(row.right).map(function (c) { return row.n + c; }).filter(function (s) { return !occ[s]; });
    };
    var picked = null;
    for (var i = 0; i < rows.length && !picked; i++) {
      if (seatFee(rows[i].n + 'A')) continue;
      var f = freeIn(rows[i]);
      if (f.length >= pax) picked = f.slice(0, pax);
    }
    if (!picked) {
      var all = [];
      rows.forEach(function (row) { freeIn(row).forEach(function (s) { all.push(s); }); });
      all.sort(function (a, b) { return seatFee(a) - seatFee(b); });
      picked = all.slice(0, pax);
    }
    var out = [];
    for (var k = 0; k < pax; k++) out.push(picked[k] || null);
    state.seats[legIdx] = out;
  }

  /* ------------------------------------------------------------------
     Views
  ------------------------------------------------------------------ */
  function pageHead(eyebrow, title, sub) {
    return '<div class="page-head"><p class="eyebrow">' + esc(eyebrow) + '</p><h1>' + esc(title) + '</h1>' +
      (sub ? '<p class="sub">' + sub + '</p>' : '') + '</div>';
  }

  function airportOptions(sel) {
    return AIRPORTS.map(function (a) {
      return '<option value="' + a.code + '"' + (a.code === sel ? ' selected' : '') + '>' + esc(a.city) + ' (' + a.code + ')</option>';
    }).join('');
  }

  function viewSearch() {
    var s = state.search;
    var rows = ROUTES.map(function (rt) {
      var list = generateFlights(rt[0], rt[1], s.depart);
      var cheapest = Math.min.apply(null, list.map(function (x) { return x.price; }));
      var fastest = Math.min.apply(null, list.map(function (x) { return x.dur; }));
      return '<button type="button" class="board-row" data-action="route" data-from="' + rt[0] + '" data-to="' + rt[1] + '">' +
        '<span class="b-code">' + rt[0] + ' <i>&rsaquo;</i> ' + rt[1] + '</span>' +
        '<span class="b-name">' + esc(BY_CODE[rt[0]].city) + ' to ' + esc(BY_CODE[rt[1]].city) + '</span>' +
        '<span class="b-dur">' + fmtDur(fastest) + '</span>' +
        '<span class="b-price">from ' + money(cheapest) + '</span></button>';
    }).join('');

    return '<section class="view">' +
      pageHead('Meradian Air', 'Where are you flying?') +
      '<form class="panel lift search" id="search-form" novalidate>' +
        '<div class="seg" role="radiogroup" aria-label="Trip type">' +
          '<label><input type="radio" name="trip" value="return" data-fk="trip-return"' + (s.trip === 'return' ? ' checked' : '') + '><span>Return</span></label>' +
          '<label><input type="radio" name="trip" value="oneway" data-fk="trip-oneway"' + (s.trip === 'oneway' ? ' checked' : '') + '><span>One way</span></label>' +
        '</div>' +
        '<div class="route">' +
          '<label class="field"><span>From</span><select id="f-from">' + airportOptions(s.from) + '</select></label>' +
          '<button type="button" class="swap" data-action="swap" aria-label="Swap origin and destination">' +
            '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7 4 3 8l4 4"/><path d="M3 8h14"/><path d="m17 20 4-4-4-4"/><path d="M21 16H7"/></svg>' +
          '</button>' +
          '<label class="field"><span>To</span><select id="f-to">' + airportOptions(s.to) + '</select></label>' +
        '</div>' +
        '<div class="options">' +
          '<label class="field"><span>Depart</span><input type="date" id="f-depart" value="' + s.depart + '" min="' + today() + '"></label>' +
          '<label class="field"><span>Return</span><input type="date" id="f-return" value="' + s.ret + '" min="' + s.depart + '"' + (s.trip === 'oneway' ? ' disabled' : '') + '></label>' +
          '<label class="field"><span>Passengers</span><select id="f-pax">' +
            [1, 2, 3, 4, 5, 6].map(function (k) { return '<option value="' + k + '"' + (k === s.pax ? ' selected' : '') + '>' + k + (k === 1 ? ' passenger' : ' passengers') + '</option>'; }).join('') +
          '</select></label>' +
          '<label class="field"><span>Cabin</span><select id="f-cabin">' +
            Object.keys(CABINS).map(function (k) { return '<option value="' + k + '"' + (k === s.cabin ? ' selected' : '') + '>' + CABINS[k].label + '</option>'; }).join('') +
          '</select></label>' +
        '</div>' +
        '<p class="form-error" id="search-error" role="alert">' + esc(state.errors.search || '') + '</p>' +
        '<div class="actions"><button class="btn primary" type="submit">Search flights</button></div>' +
      '</form>' +
      '<section class="board" aria-label="Popular routes">' +
        '<div class="board-head"><span>Popular routes</span><span>Economy fares for ' + esc(fmtDate(s.depart)) + '</span></div>' + rows +
      '</section>' +
    '</section>';
  }

  function flightCard(f, tags) {
    var fare = fareFor(f);
    var arrNote = f.arrDay ? '<sup>' + (f.arrDay > 0 ? '+' : '') + f.arrDay + '</sup>' : '';
    var tagHtml = tags.map(function (t) { return '<span class="tag">' + t + '</span>'; }).join('');
    return '<article class="flight" aria-label="' + esc(f.no) + ' departing ' + fmtTime(f.depMin) + '">' +
      '<div class="f-times">' +
        '<div class="f-end"><b class="time">' + fmtTime(f.depMin) + '</b><span class="iata">' + f.from + '</span></div>' +
        '<div class="f-track"><span>' + fmtDur(f.dur) + '</span><span class="line"></span><span>' + (f.stops ? '1 stop via ' + f.via : 'Nonstop') + '</span></div>' +
        '<div class="f-end"><b class="time">' + fmtTime(f.arrMin) + arrNote + '</b><span class="iata">' + f.to + '</span></div>' +
      '</div>' +
      '<div class="f-meta"><span>' + AIRLINE + ' ' + esc(f.no) + '</span><span>' + f.aircraft + '</span>' + tagHtml + '</div>' +
      '<div class="f-buy"><div class="price"><b>' + money(fare) + '</b><span>per passenger</span></div>' +
        '<button type="button" class="btn primary" data-action="select-flight" data-id="' + f.id + '">Select</button></div>' +
    '</article>';
  }

  function viewResults() {
    var s = state.search;
    var legIdx = state.legs.length;
    var round = s.trip === 'return';
    var from = legIdx === 0 ? s.from : s.to;
    var to = legIdx === 0 ? s.to : s.from;
    var date = legIdx === 0 ? s.depart : s.ret;
    var all = generateFlights(from, to, date);
    var cheapest = Math.min.apply(null, all.map(function (f) { return f.price; }));
    var fastest = Math.min.apply(null, all.map(function (f) { return f.dur; }));
    var list = state.nonstop ? all.filter(function (f) { return f.stops === 0; }) : all.slice();
    list.sort(function (a, b) {
      if (state.sort === 'duration') return a.dur - b.dur;
      if (state.sort === 'departure') return a.depMin - b.depMin;
      return a.price - b.price;
    });

    var title = round ? (legIdx === 0 ? 'Choose your outbound flight' : 'Choose your return flight') : 'Choose your flight';
    var sub = esc(BY_CODE[from].city) + ' (' + from + ') to ' + esc(BY_CODE[to].city) + ' (' + to + ') &middot; ' + esc(fmtDate(date)) +
      ' &middot; ' + s.pax + (s.pax === 1 ? ' passenger' : ' passengers') + ' &middot; ' + CABINS[s.cabin].label;

    var cards = list.map(function (f) {
      var tags = [];
      if (f.price === cheapest) tags.push('Lowest fare');
      if (f.dur === fastest) tags.push('Fastest');
      return flightCard(f, tags);
    }).join('');

    if (!list.length) {
      cards = '<div class="panel empty"><p>No nonstop flights on this route and date.</p>' +
        '<button type="button" class="btn" data-action="show-all">Show flights with stops</button></div>';
    }

    return '<section class="view">' +
      pageHead(round ? 'Leg ' + (legIdx + 1) + ' of 2' : 'Step 2', title, sub) +
      '<div class="toolbar">' +
        '<label class="field"><span>Sort by</span><select id="sort">' +
          [['price', 'Lowest price'], ['duration', 'Shortest trip'], ['departure', 'Earliest departure']].map(function (o) {
            return '<option value="' + o[0] + '"' + (state.sort === o[0] ? ' selected' : '') + '>' + o[1] + '</option>';
          }).join('') +
        '</select></label>' +
        '<label class="check"><input type="checkbox" id="nonstop"' + (state.nonstop ? ' checked' : '') + '> Nonstop only</label>' +
      '</div>' +
      '<div class="flights">' + cards + '</div>' +
      '<div class="actions"><button type="button" class="btn" data-action="results-back">Back</button></div>' +
    '</section>';
  }

  function seatButton(row, c, ctx) {
    var id = row.n + c;
    var taken = !!ctx.occ[id];
    var idx = ctx.mine.indexOf(id);
    var off = row.cabin !== state.search.cabin;
    var cls = 'seat' + (row.cabin === 'business' ? ' biz' : '') + (seatFee(id) ? ' fee' : '');
    var label = id + ', ' + CABINS[row.cabin].label;
    var inner = c;
    var attrs = '';
    if (taken) {
      cls += ' taken'; label += ', taken'; inner = ''; attrs = ' disabled';
    } else if (off) {
      cls += ' off'; label += ', not in your selected cabin'; attrs = ' disabled';
    } else if (idx >= 0) {
      inner = String(idx + 1);
      label += ', selected for passenger ' + (idx + 1);
      if (idx === state.seatPax) { cls += ' sel-me'; attrs = ' aria-pressed="true"'; }
      else { cls += ' sel-other'; attrs = ' aria-disabled="true"'; }
    } else {
      if (seatFee(id)) label += ', extra legroom, ' + money(SEAT_FEE);
      attrs = ' aria-pressed="false"';
    }
    return '<button type="button" class="' + cls + '" data-action="seat" data-seat="' + id + '" data-fk="seat-' + id + '" aria-label="' + label + '"' + attrs + '>' + inner + '</button>';
  }

  function viewSeats() {
    var leg = state.seatLeg;
    var f = state.legs[leg];
    var pax = state.search.pax;
    var mine = state.seats[leg];
    var ctx = { occ: occupiedFor(f), mine: mine };

    var legTabs = '';
    if (state.legs.length > 1) {
      legTabs = '<div class="tabs" aria-label="Flight">' + state.legs.map(function (l, i) {
        var done = state.seats[i].filter(Boolean).length;
        return '<button type="button" class="chip" data-action="leg-tab" data-leg="' + i + '" data-fk="leg-' + i + '" aria-pressed="' + (i === leg) + '">' +
          '<small>' + (i === 0 ? 'Outbound' : 'Return') + '</small><b>' + l.from + ' &rarr; ' + l.to + ' &middot; ' + done + '/' + pax + '</b></button>';
      }).join('') + '</div>';
    }

    var paxTabs = mine.map(function (seat, i) {
      return '<button type="button" class="chip" data-action="pax-tab" data-pax="' + i + '" data-fk="pax-' + i + '" aria-pressed="' + (i === state.seatPax) + '">' +
        '<small>Passenger ' + (i + 1) + '</small><b>' + (seat || 'No seat yet') + '</b></button>';
    }).join('');

    var rowsHtml = '';
    var lastCabin = '';
    ROWS.forEach(function (row) {
      if (row.cabin !== lastCabin) {
        rowsHtml += '<div class="cabin-tag">' + CABINS[row.cabin].label + '</div>';
        lastCabin = row.cabin;
      }
      if (row.n === EXIT_ROW) rowsHtml += '<div class="exit-tag">Exit row &middot; extra legroom</div>';
      var cell = function (c) { return seatButton(row, c, ctx); };
      rowsHtml += '<div class="srow' + (row.cabin === 'business' ? ' biz' : '') + '" role="group" aria-label="Row ' + row.n + '">' +
        row.left.map(cell).join('') + '<span class="rownum" aria-hidden="true">' + row.n + '</span>' + row.right.map(cell).join('') + '</div>';
    });

    var t = totals();
    var complete = seatsComplete();

    return '<section class="view">' +
      pageHead('Step 3', 'Choose your seats',
        esc(f.from) + ' to ' + esc(f.to) + ' &middot; ' + esc(AIRLINE) + ' ' + esc(f.no) + ' &middot; ' + esc(fmtDate(f.date)) + '. Seats in the ' + CABINS[state.search.cabin].label.toLowerCase() + ' cabin are open to you.') +
      legTabs +
      '<div class="panel">' +
        '<div class="tabs" style="margin-bottom:14px" aria-label="Passenger">' + paxTabs + '</div>' +
        '<div class="legend-row" style="margin-bottom:18px">' +
          '<span><i class="sw"></i>Available</span><span><i class="sw sel"></i>Selected</span><span><i class="sw taken"></i>Taken</span>' +
          '<span><i class="sw fee"></i>Extra legroom, ' + money(SEAT_FEE) + '</span></div>' +
        '<div class="fuselage" aria-label="Seat map">' + rowsHtml + '</div>' +
      '</div>' +
      '<div class="actions">' +
        '<button type="button" class="btn" data-action="seats-back">Back</button>' +
        '<button type="button" class="btn" data-action="auto-seats">Assign seats for me</button>' +
        '<span class="spacer"></span>' +
        (t.seatFees ? '<span class="note">Seat fees ' + money(t.seatFees) + '</span>' : '') +
        '<button type="button" class="btn primary" data-action="seats-next"' + (complete ? '' : ' disabled') + '>Continue to passengers</button>' +
      '</div>' +
    '</section>';
  }

  function fieldHtml(id, label, value, type, errKey, extra) {
    var err = state.errors[errKey];
    return '<label class="field"><span>' + label + '</span>' +
      '<input id="' + id + '" type="' + type + '" value="' + esc(value) + '" ' + (extra || '') + (err ? ' aria-invalid="true" aria-describedby="' + id + '-err"' : '') + '>' +
      (err ? '<span class="err" id="' + id + '-err">' + esc(err) + '</span>' : '') + '</label>';
  }

  function viewPassengers() {
    var blocks = state.passengers.map(function (p, i) {
      return '<div class="panel p-block"><h3>Passenger ' + (i + 1) + '</h3><div class="grid-2">' +
        fieldHtml('p' + i + '-first', 'First name', p.first, 'text', 'first' + i, 'data-pfield="first" data-pi="' + i + '" autocomplete="given-name"') +
        fieldHtml('p' + i + '-last', 'Last name', p.last, 'text', 'last' + i, 'data-pfield="last" data-pi="' + i + '" autocomplete="family-name"') +
        '</div></div>';
    }).join('');

    return '<section class="view">' +
      pageHead('Step 4', 'Who is travelling?', 'Enter names exactly as they appear on each passport or ID.') +
      '<form id="pax-form" class="view" novalidate>' + blocks +
        '<div class="panel p-block"><h3>Contact details</h3><div class="grid-2">' +
          fieldHtml('c-email', 'Email', state.contact.email, 'email', 'email', 'autocomplete="email"') +
          fieldHtml('c-phone', 'Phone', state.contact.phone, 'tel', 'phone', 'autocomplete="tel"') +
        '</div><p class="note">We show your booking reference on screen after you confirm.</p></div>' +
        '<div class="actions"><button type="button" class="btn" data-action="pax-back">Back</button><span class="spacer"></span>' +
        '<button type="submit" class="btn primary">Review booking</button></div>' +
      '</form>' +
    '</section>';
  }

  function priceRows(t) {
    return '<dl class="rows">' +
      '<div><dt>Fares</dt><dd>' + money(t.fares) + '</dd></div>' +
      '<div><dt>Taxes and airport charges</dt><dd>' + money(t.taxes) + '</dd></div>' +
      '<div><dt>Seat selection</dt><dd>' + (t.seatFees ? money(t.seatFees) : 'Free') + '</dd></div>' +
      '<div class="total"><dt>Total</dt><dd>' + money(t.total) + '</dd></div></dl>';
  }

  function viewReview() {
    var t = totals();
    var legs = state.legs.map(function (f, i) {
      var rows = state.passengers.map(function (p, k) {
        return '<tr><td>' + esc(p.first.trim() + ' ' + p.last.trim()) + '</td><td class="mono">' + state.seats[i][k] + '</td>' +
          '<td>' + CABINS[state.search.cabin].label + '</td></tr>';
      }).join('');
      return '<div class="r-leg"><h3>' + (state.legs.length > 1 ? (i === 0 ? 'Outbound' : 'Return') + ' &middot; ' : '') + esc(BY_CODE[f.from].city) + ' to ' + esc(BY_CODE[f.to].city) + '</h3>' +
        '<p class="sub">' + esc(fmtDate(f.date)) + ' &middot; ' + fmtTime(f.depMin) + ' to ' + fmtTime(f.arrMin) + (f.arrDay ? ' (' + (f.arrDay > 0 ? '+' : '') + f.arrDay + ' day)' : '') +
        ' &middot; ' + esc(AIRLINE) + ' ' + esc(f.no) + ' &middot; ' + (f.stops ? '1 stop via ' + f.via : 'Nonstop') + '</p>' +
        '<div class="table-wrap"><table><thead><tr><th>Passenger</th><th>Seat</th><th>Cabin</th></tr></thead><tbody>' + rows + '</tbody></table></div></div>';
    }).join('');

    return '<section class="view">' +
      pageHead('Step 5', 'Review and confirm') +
      '<div class="panel review-legs">' + legs + '</div>' +
      '<div class="panel"><h3 style="margin-bottom:8px">Contact</h3><p>' + esc(state.contact.email) + ' &middot; ' + esc(state.contact.phone) + '</p></div>' +
      '<div class="panel"><h3 style="margin-bottom:12px">Price</h3>' + priceRows(t) +
        '<p class="note" style="margin-top:12px">Demo site: no payment is taken when you confirm.</p></div>' +
      '<div class="actions"><button type="button" class="btn" data-action="review-back">Back</button><span class="spacer"></span>' +
        '<button type="button" class="btn primary" data-action="confirm">Confirm booking</button></div>' +
    '</section>';
  }

  function barcode(seed) {
    var r = rng('bar|' + seed);
    var h = '';
    for (var i = 0; i < 40; i++) {
      h += '<i style="width:' + (1 + Math.floor(r() * 3)) + 'px;margin-right:' + (1 + Math.floor(r() * 2)) + 'px"></i>';
    }
    return '<div class="barcode" aria-hidden="true">' + h + '</div>';
  }

  var PLANE = '<svg viewBox="0 0 24 24" width="30" height="30" fill="currentColor" aria-hidden="true" style="transform:rotate(90deg)"><path d="M21 16v-2l-8-5V3.5a1.5 1.5 0 0 0-3 0V9l-8 5v2l8-2.5V19l-2 1.5V22l3.5-1 3.5 1v-1.5L13 19v-5.5l8 2.5z"/></svg>';

  function passHtml(b, legIdx, paxIdx) {
    var f = b.legs[legIdx];
    var p = b.passengers[paxIdx];
    var seat = b.seats[legIdx][paxIdx];
    var g = rng('gate|' + f.id);
    var gate = 'ABCD'.charAt(Math.floor(g() * 4)) + (1 + Math.floor(g() * 18));
    var cabin = CABINS[b.search.cabin].label;
    return '<article class="pass' + (b.status === 'cancelled' ? ' void' : '') + '" aria-label="Boarding pass, ' + esc(p.first) + ' ' + esc(p.last) + ', ' + f.from + ' to ' + f.to + '">' +
      '<div class="pass-main">' +
        '<div class="pass-top"><span>' + AIRLINE + '</span><span>' + (b.status === 'cancelled' ? 'Cancelled' : 'Boarding pass') + '</span></div>' +
        '<div class="pass-route"><div><b class="code">' + f.from + '</b><span>' + esc(BY_CODE[f.from].city) + '</span></div>' + PLANE +
          '<div><b class="code">' + f.to + '</b><span>' + esc(BY_CODE[f.to].city) + '</span></div></div>' +
        '<dl class="pass-grid">' +
          '<div><dt>Passenger</dt><dd>' + esc(p.last.trim().toUpperCase()) + '/' + esc(p.first.trim().toUpperCase()) + '</dd></div>' +
          '<div><dt>Flight</dt><dd>' + esc(f.no) + '</dd></div>' +
          '<div><dt>Date</dt><dd>' + esc(fmtDate(f.date)) + '</dd></div>' +
          '<div><dt>Boards</dt><dd>' + fmtTime(f.depMin - 40) + '</dd></div>' +
          '<div><dt>Departs</dt><dd>' + fmtTime(f.depMin) + '</dd></div>' +
          '<div><dt>Gate</dt><dd>' + gate + '</dd></div>' +
          '<div><dt>Cabin</dt><dd>' + cabin + '</dd></div>' +
        '</dl>' +
      '</div>' +
      '<div class="pass-stub"><div class="stub-seat"><small>Seat</small><b>' + seat + '</b></div>' +
        '<div>' + barcode(b.pnr + f.id + paxIdx) + '<div class="stub-pnr" style="margin-top:8px">' + b.pnr + '</div></div></div>' +
    '</article>';
  }

  function passesHtml(b) {
    var html = '';
    b.legs.forEach(function (f, i) {
      b.passengers.forEach(function (p, k) { html += passHtml(b, i, k); });
    });
    return '<div class="passes">' + html + '</div>';
  }

  function viewConfirm() {
    var b = state.booking;
    return '<section class="view">' +
      '<div class="confirm-head"><p class="eyebrow">Booking confirmed</p><div class="pnr" id="pnr">' + b.pnr + '</div>' +
        '<p>Keep this reference. You need it with a passenger’s last name to manage the booking.</p>' +
        '<div class="actions"><button type="button" class="btn small" data-action="copy-pnr" data-pnr="' + b.pnr + '">Copy reference</button>' +
        '<button type="button" class="btn small" data-action="manage-open" data-pnr="' + b.pnr + '">Manage booking</button>' +
        '<button type="button" class="btn small primary" data-action="new-booking">Book another flight</button></div></div>' +
      passesHtml(b) +
    '</section>';
  }

  function viewManage() {
    var m = state.manage;
    var form = '<form class="panel lift search" id="manage-form" novalidate>' +
      '<div class="options">' +
        '<label class="field"><span>Booking reference</span><input id="m-pnr" type="text" value="' + esc(m.pnr) + '" maxlength="6" autocapitalize="characters" autocomplete="off" placeholder="e.g. K7M2QX"></label>' +
        '<label class="field"><span>Passenger last name</span><input id="m-last" type="text" value="' + esc(m.last) + '" autocomplete="family-name"></label>' +
      '</div>' +
      '<p class="form-error" role="alert">' + esc(m.error) + '</p>' +
      '<div class="actions"><button type="submit" class="btn primary">Find booking</button></div></form>';

    var detail = '';
    if (m.booking) {
      var b = m.booking;
      var cancelUi = '';
      if (b.status === 'confirmed') {
        cancelUi = m.confirmCancel
          ? '<p>Cancel this booking? Your seats will be released.</p><div class="actions"><button type="button" class="btn danger" data-action="cancel-confirm">Yes, cancel booking</button><button type="button" class="btn" data-action="cancel-abort">Keep booking</button></div>'
          : '<div class="actions"><button type="button" class="btn danger" data-action="cancel-start">Cancel booking</button></div>';
      }
      detail = '<div class="panel p-block"><div class="actions"><h2 style="margin-right:auto">' + b.pnr + '</h2>' +
        '<span class="pill ' + (b.status === 'confirmed' ? 'ok' : 'bad') + '">' + b.status + '</span></div>' +
        '<p class="sub">Booked ' + esc(new Date(b.createdAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })) + ' &middot; Total ' + money(b.totals.total) + '</p>' +
        cancelUi + '</div>' + passesHtml(b);
    }

    var all = loadBookings().slice().reverse();
    var list = '';
    if (all.length) {
      list = '<section class="panel"><h3 style="margin-bottom:6px">Bookings on this device</h3><div class="booking-list">' + all.map(function (b) {
        var f = b.legs[0];
        return '<div class="booking-row"><span class="mono">' + b.pnr + '</span>' +
          '<span>' + f.from + ' &rarr; ' + f.to + (b.legs.length > 1 ? ' &rarr; ' + f.from : '') + ' &middot; ' + esc(fmtDate(f.date)) + '</span>' +
          '<span class="pill ' + (b.status === 'confirmed' ? 'ok' : 'bad') + '">' + b.status + '</span>' +
          '<button type="button" class="btn small" data-action="manage-open" data-pnr="' + b.pnr + '">View</button></div>';
      }).join('') + '</div></section>';
    }

    return '<section class="view">' + pageHead('Manage booking', 'Find your booking', 'Look up a booking with its reference and a passenger’s last name.') + form + detail + list + '</section>';
  }

  function summaryHtml() {
    if (!state.legs.length || ['results', 'seats', 'passengers', 'review'].indexOf(state.view) < 0) return '';
    var t = totals();
    var partial = state.legs.length < legCount();
    var legs = state.legs.map(function (f, i) {
      return '<div class="s-leg"><div class="s-route">' + f.from + ' <i>&rarr;</i> ' + f.to + '</div>' +
        '<div class="s-line">' + esc(fmtDate(f.date)) + '</div>' +
        '<div class="s-line">' + fmtTime(f.depMin) + ' to ' + fmtTime(f.arrMin) + (f.arrDay ? ' (' + (f.arrDay > 0 ? '+' : '') + f.arrDay + ')' : '') + ' &middot; ' + esc(f.no) + '</div>' +
        (state.seats[i] && state.seats[i].some(Boolean) ? '<div class="s-line">Seats ' + state.seats[i].filter(Boolean).join(', ') + '</div>' : '') + '</div>';
    }).join('');
    return '<div class="panel summary"><h2>Your trip</h2>' + legs +
      '<p class="s-line">' + state.search.pax + (state.search.pax === 1 ? ' passenger' : ' passengers') + ' &middot; ' + CABINS[state.search.cabin].label + '</p>' +
      (partial ? '<p class="s-line">Fares so far</p>' : '') +
      priceRows(t) + '</div>';
  }

  var VIEWS = {
    search: viewSearch, results: viewResults, seats: viewSeats, passengers: viewPassengers,
    review: viewReview, confirm: viewConfirm, manage: viewManage
  };

  /* ------------------------------------------------------------------
     Rendering
  ------------------------------------------------------------------ */
  function normalizeReached() {
    if (state.legs.length < legCount()) state.reached = Math.min(state.reached, 1);
    else if (!seatsComplete()) state.reached = Math.min(state.reached, 2);
  }

  function renderStepper() {
    var el = $('#stepper');
    var cur = STEPS.map(function (s) { return s[0]; }).indexOf(state.view);
    el.hidden = cur < 0;
    if (cur < 0) return;
    $('.steps', el).innerHTML = STEPS.map(function (s, i) {
      return '<li><button type="button" class="step" data-action="step" data-step="' + s[0] + '"' +
        (i === cur ? ' aria-current="step"' : '') + (i > state.reached ? ' disabled' : '') +
        '><span class="n">' + (i + 1) + '</span>' + s[1] + '</button></li>';
    }).join('');
  }

  function render(focusHeading) {
    normalizeReached();
    var active = document.activeElement;
    var key = null;
    if (active && active !== document.body && $('#app').contains(active)) {
      if (active.dataset && active.dataset.fk) key = '[data-fk="' + active.dataset.fk + '"]';
      else if (active.id) key = '#' + active.id;
    }

    $('#app').innerHTML = VIEWS[state.view]();
    var sum = summaryHtml();
    $('#summary').innerHTML = sum;
    $('#summary').hidden = !sum;
    $('#layout').className = 'layout' + (sum ? ' with-aside' : '');
    renderStepper();

    $('#nav-book').removeAttribute('aria-current');
    $('#nav-manage').removeAttribute('aria-current');
    if (state.view === 'manage') $('#nav-manage').setAttribute('aria-current', 'page');
    else $('#nav-book').setAttribute('aria-current', 'page');

    if (focusHeading) {
      window.scrollTo(0, 0);
      var h = $('#app h1');
      if (h) { h.setAttribute('tabindex', '-1'); h.focus({ preventScroll: true }); }
    } else if (key) {
      var el = $('#app ' + key);
      if (el) el.focus({ preventScroll: true });
    }
  }

  function go(view) {
    if (view === 'review') {
      var e = validatePassengers();
      if (Object.keys(e).length) { state.errors = e; view = 'passengers'; }
    }
    state.view = view;
    render(true);
  }

  /* ------------------------------------------------------------------
     Actions
  ------------------------------------------------------------------ */
  function syncSearchFromForm() {
    var s = state.search;
    var v = function (id) { var el = $('#' + id); return el ? el.value : null; };
    var trip = document.querySelector('input[name="trip"]:checked');
    if (trip) s.trip = trip.value;
    if (v('f-from')) s.from = v('f-from');
    if (v('f-to')) s.to = v('f-to');
    if (v('f-depart')) s.depart = v('f-depart');
    if (v('f-return')) s.ret = v('f-return');
    if (v('f-pax')) s.pax = parseInt(v('f-pax'), 10);
    if (v('f-cabin')) s.cabin = v('f-cabin');
  }

  function submitSearch() {
    syncSearchFromForm();
    var s = state.search;
    var err = '';
    if (s.from === s.to) err = 'Choose different cities for origin and destination.';
    else if (!s.depart || s.depart < today()) err = 'Choose a departure date from today onward.';
    else if (s.trip === 'return' && (!s.ret || s.ret < s.depart)) err = 'The return date must be on or after the departure date.';
    state.errors.search = err;
    if (err) { render(); return; }

    state.legs = [];
    state.seats = [];
    state.seatLeg = 0;
    state.seatPax = 0;
    state.reached = 1;
    if (state.passengers.length !== s.pax) {
      var next = [];
      for (var i = 0; i < s.pax; i++) next.push(state.passengers[i] || { first: '', last: '' });
      state.passengers = next;
    }
    go('results');
  }

  function selectFlight(id) {
    var s = state.search;
    var legIdx = state.legs.length;
    var from = legIdx === 0 ? s.from : s.to;
    var to = legIdx === 0 ? s.to : s.from;
    var date = legIdx === 0 ? s.depart : s.ret;
    var f = generateFlights(from, to, date).filter(function (x) { return x.id === id; })[0];
    if (!f) return;
    state.legs.push(f);
    if (state.legs.length < legCount()) { render(true); return; }
    state.seats = state.legs.map(function () { return new Array(s.pax).fill(null); });
    state.seatLeg = 0;
    state.seatPax = 0;
    state.reached = 2;
    go('seats');
  }

  function clickSeat(seat) {
    var arr = state.seats[state.seatLeg];
    var p = state.seatPax;
    if (arr[p] === seat) { arr[p] = null; render(); return; }
    if (arr.indexOf(seat) >= 0) return;
    arr[p] = seat;
    for (var k = 1; k < arr.length; k++) {
      var idx = (p + k) % arr.length;
      if (!arr[idx]) { state.seatPax = idx; break; }
    }
    render();
  }

  var NAME_RE = /^[\p{L}][\p{L} '’.\-]+$/u;
  var EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

  function validatePassengers() {
    var e = {};
    state.passengers.forEach(function (p, i) {
      if (!NAME_RE.test(p.first.trim())) e['first' + i] = 'Enter a first name using letters only.';
      if (!NAME_RE.test(p.last.trim())) e['last' + i] = 'Enter a last name using letters only.';
    });
    if (!EMAIL_RE.test(state.contact.email.trim())) e.email = 'Enter an email address like name@example.com.';
    var digits = state.contact.phone.replace(/\D/g, '');
    if (digits.length < 7 || digits.length > 15) e.phone = 'Enter a phone number with 7 to 15 digits.';
    return e;
  }

  function newPnr() {
    var chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    var existing = loadBookings().map(function (b) { return b.pnr; });
    var p;
    do {
      p = '';
      for (var i = 0; i < 6; i++) p += chars.charAt(Math.floor(Math.random() * chars.length));
    } while (existing.indexOf(p) >= 0);
    return p;
  }

  function confirmBooking() {
    var booking = {
      pnr: newPnr(),
      status: 'confirmed',
      createdAt: new Date().toISOString(),
      search: JSON.parse(JSON.stringify(state.search)),
      legs: JSON.parse(JSON.stringify(state.legs)),
      seats: JSON.parse(JSON.stringify(state.seats)),
      passengers: JSON.parse(JSON.stringify(state.passengers)),
      contact: JSON.parse(JSON.stringify(state.contact)),
      totals: totals()
    };
    var list = loadBookings().slice();
    list.push(booking);
    saveBookings(list);
    state.booking = booking;
    state.legs = [];
    state.seats = [];
    state.reached = 0;
    go('confirm');
  }

  function openManage(pnr) {
    var b = loadBookings().filter(function (x) { return x.pnr === pnr; })[0] || null;
    state.manage = { pnr: pnr, last: b ? b.passengers[0].last : '', error: '', booking: b, confirmCancel: false };
    go('manage');
  }

  function submitManage() {
    var pnr = $('#m-pnr').value.trim().toUpperCase();
    var last = $('#m-last').value.trim();
    var found = loadBookings().filter(function (b) {
      return b.pnr === pnr && b.passengers.some(function (p) { return p.last.trim().toLowerCase() === last.toLowerCase(); });
    })[0] || null;
    state.manage = {
      pnr: pnr, last: last, booking: found, confirmCancel: false,
      error: found ? '' : 'No booking matches that reference and last name on this device. Check both and try again.'
    };
    render();
  }

  function cancelBooking() {
    var b = state.manage.booking;
    var list = loadBookings().map(function (x) {
      if (x.pnr === b.pnr) x.status = 'cancelled';
      return x;
    });
    saveBookings(list);
    state.manage.booking = list.filter(function (x) { return x.pnr === b.pnr; })[0];
    state.manage.confirmCancel = false;
    render();
  }

  function copyPnr(btn) {
    var pnr = btn.dataset.pnr;
    var fallback = function () { btn.textContent = 'Select the code to copy'; };
    var ok = function () {
      btn.textContent = 'Copied';
      setTimeout(function () { btn.textContent = 'Copy reference'; }, 1600);
    };
    try {
      navigator.clipboard.writeText(pnr).then(ok, fallback);
    } catch (e) { fallback(); }
  }

  /* ------------------------------------------------------------------
     Events
  ------------------------------------------------------------------ */
  document.addEventListener('click', function (ev) {
    var el = ev.target.closest('[data-action]');
    if (!el) return;
    var d = el.dataset;
    switch (d.action) {
      case 'nav':
        if (d.view === 'manage') { state.manage = { pnr: '', last: '', error: '', booking: null, confirmCancel: false }; go('manage'); }
        else go(state.view === 'confirm' || state.view === 'manage' ? 'search' : state.view);
        break;
      case 'step':
        if (d.step === 'results') { state.legs = []; state.seats = []; state.reached = Math.min(state.reached, 1); }
        go(d.step);
        break;
      case 'swap':
        syncSearchFromForm();
        var tmp = state.search.from; state.search.from = state.search.to; state.search.to = tmp;
        render();
        break;
      case 'route':
        syncSearchFromForm();
        state.search.from = d.from; state.search.to = d.to;
        submitSearch();
        break;
      case 'show-all': state.nonstop = false; render(); break;
      case 'select-flight': selectFlight(d.id); break;
      case 'results-back':
        if (state.legs.length) { state.legs.pop(); render(true); }
        else go('search');
        break;
      case 'leg-tab': state.seatLeg = parseInt(d.leg, 10); state.seatPax = 0; render(); break;
      case 'pax-tab': state.seatPax = parseInt(d.pax, 10); render(); break;
      case 'seat': clickSeat(d.seat); break;
      case 'auto-seats': autoAssign(state.seatLeg); render(); break;
      case 'seats-back': state.legs.pop(); state.seats = []; state.reached = 1; go('results'); break;
      case 'seats-next':
        if (seatsComplete()) { state.reached = Math.max(state.reached, 3); go('passengers'); }
        break;
      case 'pax-back': go('seats'); break;
      case 'review-back': go('passengers'); break;
      case 'confirm': confirmBooking(); break;
      case 'copy-pnr': copyPnr(el); break;
      case 'manage-open': openManage(d.pnr); break;
      case 'new-booking': go('search'); break;
      case 'cancel-start': state.manage.confirmCancel = true; render(); break;
      case 'cancel-abort': state.manage.confirmCancel = false; render(); break;
      case 'cancel-confirm': cancelBooking(); break;
    }
  });

  document.addEventListener('change', function (ev) {
    var t = ev.target;
    if (t.name === 'trip' || /^f-/.test(t.id)) {
      syncSearchFromForm();
      state.errors.search = '';
      if (t.id === 'f-depart' && state.search.ret < state.search.depart) state.search.ret = state.search.depart;
      render();
    } else if (t.id === 'sort') {
      state.sort = t.value; render();
    } else if (t.id === 'nonstop') {
      state.nonstop = t.checked; render();
    }
  });

  document.addEventListener('input', function (ev) {
    var t = ev.target;
    if (t.dataset && t.dataset.pfield) state.passengers[parseInt(t.dataset.pi, 10)][t.dataset.pfield] = t.value;
    else if (t.id === 'c-email') state.contact.email = t.value;
    else if (t.id === 'c-phone') state.contact.phone = t.value;
  });

  document.addEventListener('submit', function (ev) {
    ev.preventDefault();
    var id = ev.target.id;
    if (id === 'search-form') submitSearch();
    else if (id === 'manage-form') submitManage();
    else if (id === 'pax-form') {
      var e = validatePassengers();
      state.errors = e;
      if (Object.keys(e).length) {
        render();
        var first = $('#app [aria-invalid="true"]');
        if (first) first.focus();
        return;
      }
      state.reached = Math.max(state.reached, 4);
      go('review');
    }
  });

  render(false);
})();
