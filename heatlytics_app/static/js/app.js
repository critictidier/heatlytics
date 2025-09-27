(() => {
  const SERIES_IDS = Object.freeze({
    curve: 'curve',
    current: 'current',
    dew: 'dew',
  });

  const markerLinesPlugin = {
    id: 'markerLines',
    afterDraw(chart) {
      const lines = chart?.options?.markerLines;
      if (!Array.isArray(lines) || !lines.length) return;
      const xScale = chart.scales?.x;
      const yScale = chart.scales?.y;
      if (!xScale || !yScale) return;
      const ctx = chart.ctx;
      for (const line of lines) {
        const value = Number(line?.value);
        if (!Number.isFinite(value)) continue;
        const x = xScale.getPixelForValue(value);
        if (!Number.isFinite(x)) continue;
        ctx.save();
        ctx.strokeStyle = line?.color || 'rgba(255,255,255,0.35)';
        ctx.lineWidth = line?.lineWidth ?? 1.2;
        const dash = Array.isArray(line?.dash) ? line.dash : [6, 4];
        ctx.setLineDash(dash);
        ctx.beginPath();
        ctx.moveTo(x, yScale.top);
        ctx.lineTo(x, yScale.bottom);
        ctx.stroke();
        ctx.restore();
      }
    },
  };

  if (typeof Chart !== 'undefined') {
    Chart.register(markerLinesPlugin);
  }

  const initialState = window.__INITIAL_STATE__ || {};

  const fallbackCvRanges = {
    gross: { min: 36.0, max: 41.0, default: 38.7 },
    net: { min: 33.0, max: 37.0, default: 34.9 },
  };
  const fallbackLimits = {
    return_temp: { min: 20.0, max: 80.0 },
    flow_temp: { min: 20.0, max: 80.0 },
    delta_t: { min: 2.0, max: 30.0 },
    modulation_pct: { min: 0.0, max: 100.0 },
  };

  const cvRanges = initialState.cv_ranges || fallbackCvRanges;
  const limits = initialState.limits || fallbackLimits;

  const defaultCurve = initialState.efficiency_curve || { points: [], dew_point: 56 };

  const appState = {
    inputs: {
      model: initialState.inputs?.model || 'H24',
      basis: initialState.inputs?.basis || 'gross',
      return_temp: Number(initialState.inputs?.return_temp ?? 30.0),
      delta_t: Number(initialState.inputs?.delta_t ?? 15.0),
      flow_temp: Number(initialState.inputs?.flow_temp ?? 45.0),
      modulation_pct: Number(initialState.inputs?.modulation_pct ?? 40.0),
      cv: Number(initialState.inputs?.cv ?? (cvRanges.gross?.default ?? 38.7)),
    },
    outputs: initialState.outputs || null,
    sweep: initialState.sweep || [],
    efficiencyCurve: defaultCurve,
  };

  const $ = (id) => document.getElementById(id);
  const controls = {
    model: $('model'),
    retRange: $('ret'),
    retNumber: $('ret_n'),
    dTRange: $('dT'),
    dTNumber: $('dT_n'),
    flowRange: $('flow'),
    flowNumber: $('flow_n'),
    modRange: $('mod'),
    modNumber: $('mod_n'),
    cvRange: $('cv'),
    cvNumber: $('cv_n'),
    cvLabel: $('cv_label'),
    basisRadios: Array.from(document.querySelectorAll('input[name="basis"]')),
    basisBadge: $('basis_badge'),
    basisBadgeOutput: $('basis_badge_output'),
    condMode: $('cond_mode'),
    mwt: $('mwt'),
    retOut: $('ret_out'),
    flowOut: $('flow_out'),
    minKw: $('min_kW'),
    maxKw: $('max_kW'),
    dynKw: $('dyn_kW'),
    effPct: $('eff_pct'),
    gasFactor: $('gas_factor'),
    gasKw: $('gas_kW'),
    m3h: $('m3h'),
    m3hLabel: $('m3h_label'),
    tableBody: document.querySelector('#table tbody'),
    presetLow: $('preset_low'),
    presetMed: $('preset_med'),
    presetHigh: $('preset_high'),
    efficiencyCanvas: $('efficiency_chart'),
    chartPanel: $('efficiency_panel'),
    chartExpandButton: $('chart_fullscreen_btn'),
  };

  const OUTPUT_DECIMALS = {
    mwt: 1,
    return_temp: 1,
    flow_temp: 1,
    min_kW: 2,
    max_kW: 2,
    dyn_kW: 2,
    efficiency_pct: 1,
    gas_factor: 4,
    gas_kW: 2,
    m3h: 3,
  };

  const SWEEP_DECIMALS = {
    dyn_kW: 2,
    efficiency_pct: 1,
    gas_factor: 4,
    gas_kW: 2,
    m3h: 3,
  };

  let efficiencyChart = null;
  let requestSeq = 0;
  let currentSeq = 0;
  let linking = false;

  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
  const toNumber = (value, fallback = 0) => {
    const num = Number.parseFloat(value);
    return Number.isNaN(num) ? fallback : num;
  };
  const formatNumber = (value, decimals) => {
    if (typeof value !== 'number' || Number.isNaN(value)) return '-';
    return value.toFixed(decimals);
  };
  const basisLabel = (basis) => (basis === 'gross' ? 'Gross (GCV)' : 'Net (NCV)');
  const getCssVar = (name, fallback = '#ffffff') => {
    const styles = getComputedStyle(document.documentElement);
    const value = styles.getPropertyValue(name);
    return value ? value.trim() || fallback : fallback;
  };
  const setPct = (el) => {
    if (!el) return;
    const min = Number.parseFloat(el.min ?? '0');
    const max = Number.parseFloat(el.max ?? '100');
    const val = Number.parseFloat(el.value ?? String(min));
    const pct = max === min ? 0 : ((val - min) / (max - min)) * 100;
    el.style.setProperty('--pct', `${pct}%`);
  };
  const setPair = (rangeEl, numberEl, value, decimals = 1) => {
    if (!rangeEl || !numberEl) return;
    const multiplier = 10 ** decimals;
    const normalised = Math.round(Number(value) * multiplier) / multiplier;
    const text = Number.isNaN(normalised) ? '0' : normalised.toFixed(decimals);
    rangeEl.value = text;
    numberEl.value = text;
    setPct(rangeEl);
  };

  const curvesEqual = (a, b) => {
    if (!a || !b) return false;
    const ptsA = Array.isArray(a.points) ? a.points : [];
    const ptsB = Array.isArray(b.points) ? b.points : [];
    if (ptsA.length !== ptsB.length) return false;
    for (let i = 0; i < ptsA.length; i += 1) {
      const pa = ptsA[i];
      const pb = ptsB[i];
      if (Math.abs(Number(pa?.return_temp) - Number(pb?.return_temp)) > 1e-6) return false;
      if (Math.abs(Number(pa?.efficiency_pct) - Number(pb?.efficiency_pct)) > 1e-6) return false;
    }
    return Math.abs(Number(a.dew_point) - Number(b.dew_point)) <= 1e-6;
  };

  const getInterpolatedPoint = (rawPoints, target) => {
    if (!Array.isArray(rawPoints) || !rawPoints.length) return null;
    const xTarget = Number(target);
    if (!Number.isFinite(xTarget)) return null;
    let lower = null;
    let upper = null;
    for (const pt of rawPoints) {
      const x = Number(pt?.return_temp);
      const y = Number(pt?.efficiency_pct);
      if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
      if (x <= xTarget && (!lower || x > lower.x)) lower = { x, y };
      if (x >= xTarget && (!upper || x < upper.x)) upper = { x, y };
    }
    if (!lower && !upper) return null;
    if (!lower) return { x: upper.x, y: upper.y };
    if (!upper) return { x: lower.x, y: lower.y };
    if (upper.x === lower.x) return { x: xTarget, y: lower.y };
    const slope = (upper.y - lower.y) / (upper.x - lower.x);
    return { x: xTarget, y: lower.y + slope * (xTarget - lower.x) };
  };

  const ensureEfficiencyChart = () => {
    if (efficiencyChart || !controls.efficiencyCanvas || typeof Chart === 'undefined') {
      return efficiencyChart;
    }
    const ctx = controls.efficiencyCanvas.getContext('2d');
    if (!ctx) return null;
    const textColor = getCssVar('--text', '#eef1f6');
    const mutedColor = getCssVar('--muted', '#aeb8c6');
    const gridColor = 'rgba(255,255,255,0.08)';
    const xMin = Number(limits?.return_temp?.min ?? 20);
    const xMax = Number(limits?.return_temp?.max ?? 80);

    efficiencyChart = new Chart(ctx, {
      type: 'line',
      data: { datasets: [] },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: 'nearest', intersect: false },
        animation: false,
        scales: {
          x: {
            type: 'linear',
            title: { display: true, text: 'Return temperature (deg C)', color: textColor },
            ticks: { color: mutedColor },
            grid: { color: gridColor },
            min: xMin,
            max: xMax,
          },
          y: {
            title: { display: true, text: 'Efficiency (%)', color: textColor },
            ticks: { color: mutedColor },
            grid: { color: gridColor },
          },
        },
        elements: {
          point: { radius: 0 },
          line: { borderWidth: 2, tension: 0.25 },
        },
        plugins: {
          legend: { labels: { color: textColor, usePointStyle: true } },
          tooltip: {
            callbacks: {
              label(context) {
                const x = context.parsed.x;
                const y = context.parsed.y;
                const xText = Number.isFinite(x) ? x.toFixed(1) : '-';
                const yText = Number.isFinite(y) ? y.toFixed(2) : '-';
                return `${yText} % @ ${xText} deg C`;
              },
            },
          },
        },
        markerLines: [],
      },
    });
    return efficiencyChart;
  };

  const upsertDataset = (chart, id, config) => {
    let dataset = chart.data.datasets.find((ds) => ds.id === id);
    if (!dataset) {
      dataset = { id, data: [], parsing: false };
      chart.data.datasets.push(dataset);
    }
    Object.assign(dataset, config);
  };

  const updateEfficiencyChart = (curve, options = {}) => {
    const { replaceCurve = false } = options;
    if (curve) {
      if (replaceCurve || !appState.efficiencyCurve) {
        appState.efficiencyCurve = curve;
      } else {
        appState.efficiencyCurve = {
          ...appState.efficiencyCurve,
          dew_point: curve.dew_point ?? appState.efficiencyCurve.dew_point,
        };
      }
    }
    const workingCurve = appState.efficiencyCurve || defaultCurve;
    const chart = ensureEfficiencyChart();
    if (!chart) return;

    const rawPoints = Array.isArray(workingCurve.points) ? workingCurve.points : [];
    const points = rawPoints
      .map((pt) => ({ x: Number(pt?.return_temp), y: Number(pt?.efficiency_pct) }))
      .filter((pt) => Number.isFinite(pt.x) && Number.isFinite(pt.y))
      .sort((a, b) => a.x - b.x);

    const dewPoint = Number(workingCurve.dew_point);
    const currentReturn = Number(appState.inputs.return_temp);
    const highlightPoint = getInterpolatedPoint(rawPoints, currentReturn);
    const dewPointPoint = Number.isFinite(dewPoint) ? getInterpolatedPoint(rawPoints, dewPoint) : null;

    const condColor = 'rgba(10,132,255,0.9)';
    const condFill = 'rgba(10,132,255,0.14)';
    const nonCondColor = 'rgba(255,214,10,0.85)';
    const nonCondFill = 'rgba(255,214,10,0.12)';

    if (replaceCurve || chart.data.datasets.length === 0) {
      chart.data.datasets = [];
    }

    upsertDataset(chart, SERIES_IDS.curve, {
      label: 'Boiler efficiency (eta)',
      data: points,
      parsing: false,
      borderColor: condColor,
      backgroundColor: condFill,
      fill: true,
      pointRadius: 0,
      pointHoverRadius: 4,
      segment: {
        borderColor: (ctx) => (ctx.p0.parsed.x < (Number.isFinite(dewPoint) ? dewPoint : 56) ? condColor : nonCondColor),
        backgroundColor: (ctx) => (ctx.p0.parsed.x < (Number.isFinite(dewPoint) ? dewPoint : 56) ? condFill : nonCondFill),
      },
    });

    upsertDataset(chart, SERIES_IDS.current, {
      type: 'scatter',
      label: 'Current return',
      data: highlightPoint && Number.isFinite(highlightPoint.y) ? [highlightPoint] : [],
      parsing: false,
      pointRadius: 6,
      pointHoverRadius: 7,
      pointBackgroundColor: '#ff375f',
      pointBorderColor: '#ffffff',
      borderWidth: 1.5,
    });

    upsertDataset(chart, SERIES_IDS.dew, {
      type: 'scatter',
      label: 'Dew point (~56 deg C)',
      data: dewPointPoint && Number.isFinite(dewPointPoint.y) ? [dewPointPoint] : [],
      parsing: false,
      pointRadius: 5,
      pointHoverRadius: 6,
      pointBackgroundColor: '#ffd60a',
      pointBorderColor: '#ffffff',
      borderWidth: 1,
    });

    const markerLines = [];
    if (Number.isFinite(dewPoint)) {
      markerLines.push({ value: dewPoint, color: 'rgba(255,255,255,0.35)', dash: [6, 4], lineWidth: 1.2 });
    }
    if (Number.isFinite(currentReturn)) {
      markerLines.push({ value: currentReturn, color: 'rgba(255,55,95,0.75)', dash: [3, 3], lineWidth: 1.4 });
    }
    chart.options.markerLines = markerLines;

    if (points.length) {
      const yValues = points.map((pt) => pt.y);
      const minY = Math.min(...yValues);
      const maxY = Math.max(...yValues);
      chart.options.scales.y.suggestedMin = Math.max(80, Math.floor(minY - 1));
      chart.options.scales.y.suggestedMax = Math.min(115, Math.ceil(maxY + 1));
    }

    chart.update(replaceCurve ? undefined : 'none');
  };

  const updateBadges = (label) => {
    if (controls.basisBadge) controls.basisBadge.textContent = label;
    if (controls.basisBadgeOutput) controls.basisBadgeOutput.textContent = label;
  };

  const updateOutputs = (outputs) => {
    if (!outputs) return;
    appState.outputs = outputs;
    controls.mwt.textContent = formatNumber(outputs.mwt, OUTPUT_DECIMALS.mwt);
    controls.retOut.textContent = formatNumber(outputs.return_temp, OUTPUT_DECIMALS.return_temp);
    controls.flowOut.textContent = formatNumber(outputs.flow_temp, OUTPUT_DECIMALS.flow_temp);
    controls.condMode.textContent = outputs.condensing_mode ?? '-';
    updateBadges(outputs.basis_label ?? basisLabel(appState.inputs.basis));
    controls.minKw.textContent = formatNumber(outputs.min_kW, OUTPUT_DECIMALS.min_kW);
    controls.maxKw.textContent = formatNumber(outputs.max_kW, OUTPUT_DECIMALS.max_kW);
    controls.dynKw.textContent = formatNumber(outputs.dyn_kW, OUTPUT_DECIMALS.dyn_kW);
    controls.effPct.textContent = formatNumber(outputs.efficiency_pct, OUTPUT_DECIMALS.efficiency_pct);
    controls.gasFactor.textContent = formatNumber(outputs.gas_factor, OUTPUT_DECIMALS.gas_factor);
    controls.gasKw.textContent = formatNumber(outputs.gas_kW, OUTPUT_DECIMALS.gas_kW);
    controls.m3h.textContent = formatNumber(outputs.m3h, OUTPUT_DECIMALS.m3h);
    if (outputs.m3h_label) {
      controls.m3hLabel.textContent = outputs.m3h_label;
    }
  };

  const updateSweep = (items) => {
    if (!controls.tableBody) return;
    controls.tableBody.innerHTML = '';
    (items || []).forEach((row) => {
      const tr = document.createElement('tr');
      const modDisplay = formatNumber(row.modulation_pct ?? 0, 0);
      tr.innerHTML = `
        <td>${modDisplay}</td>
        <td>${formatNumber(row.dyn_kW, SWEEP_DECIMALS.dyn_kW)}</td>
        <td>${formatNumber(row.efficiency_pct, SWEEP_DECIMALS.efficiency_pct)}</td>
        <td>${formatNumber(row.gas_factor, SWEEP_DECIMALS.gas_factor)}</td>
        <td>${formatNumber(row.gas_kW, SWEEP_DECIMALS.gas_kW)}</td>
        <td>${formatNumber(row.m3h, SWEEP_DECIMALS.m3h)}</td>`;
      controls.tableBody.appendChild(tr);
    });
    appState.sweep = items;
  };

  const syncControlsFromState = () => {
    linking = true;
    setPair(controls.retRange, controls.retNumber, appState.inputs.return_temp, 1);
    setPair(controls.dTRange, controls.dTNumber, appState.inputs.delta_t, 1);
    setPair(controls.flowRange, controls.flowNumber, appState.inputs.flow_temp, 1);
    setPair(controls.modRange, controls.modNumber, appState.inputs.modulation_pct, 1);
    setPair(controls.cvRange, controls.cvNumber, appState.inputs.cv, 1);
    if (controls.model) controls.model.value = appState.inputs.model;
    controls.basisRadios.forEach((radio) => {
      radio.checked = radio.value === appState.inputs.basis;
    });
    linking = false;
  };

  const triggerUpdate = () => {
    const payload = {
      model: appState.inputs.model,
      basis: appState.inputs.basis,
      return_temp: appState.inputs.return_temp,
      delta_t: appState.inputs.delta_t,
      flow_temp: appState.inputs.flow_temp,
      modulation_pct: appState.inputs.modulation_pct,
      cv: appState.inputs.cv,
    };
    const seq = ++requestSeq;
    fetch('/api/calculate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
      .then((response) => (response.ok ? response.json() : Promise.reject(response)))
      .then((data) => {
        if (seq < currentSeq) return;
        currentSeq = seq;
        if (data.inputs) {
          const previousBasis = appState.inputs.basis;
          Object.assign(appState.inputs, data.inputs);
          if (appState.inputs.basis !== previousBasis) {
            setCVUIForBasis(appState.inputs.basis, { keepValue: true });
          } else {
            setPair(controls.cvRange, controls.cvNumber, appState.inputs.cv, 1);
          }
          syncControlsFromState();
        }
        updateOutputs(data.outputs);
        updateSweep(data.sweep);
        if (data.efficiency_curve) {
          const sameCurve = curvesEqual(appState.efficiencyCurve, data.efficiency_curve);
          updateEfficiencyChart(data.efficiency_curve, { replaceCurve: !sameCurve });
        } else {
          updateEfficiencyChart(undefined, { replaceCurve: false });
        }
      })
      .catch((error) => {
        console.error('Failed to update calculator', error);
      });
  };

  const applyDeltaFromRet = ({ emitUpdate = true } = {}) => {
    if (linking) return;
    linking = true;
    const delta = clamp(toNumber(controls.dTRange?.value, appState.inputs.delta_t), limits.delta_t.min, limits.delta_t.max);
    const retMin = limits.return_temp.min;
    const retMax = limits.return_temp.max;
    const flowMin = limits.flow_temp.min;
    const flowMax = limits.flow_temp.max;

    let ret = clamp(toNumber(controls.retRange?.value, appState.inputs.return_temp), retMin, retMax);
    let flow = clamp(ret + delta, flowMin, flowMax);
    ret = clamp(flow - delta, retMin, retMax);
    flow = ret + delta;

    appState.inputs.return_temp = ret;
    appState.inputs.delta_t = delta;
    appState.inputs.flow_temp = flow;

    setPair(controls.retRange, controls.retNumber, ret, 1);
    setPair(controls.dTRange, controls.dTNumber, delta, 1);
    setPair(controls.flowRange, controls.flowNumber, flow, 1);
    linking = false;
    updateEfficiencyChart(undefined, { replaceCurve: false });
    if (emitUpdate) triggerUpdate();
  };

  const applyDeltaFromFlow = ({ emitUpdate = true } = {}) => {
    if (linking) return;
    linking = true;
    const delta = clamp(toNumber(controls.dTRange?.value, appState.inputs.delta_t), limits.delta_t.min, limits.delta_t.max);
    const retMin = limits.return_temp.min;
    const retMax = limits.return_temp.max;
    const flowMin = limits.flow_temp.min;
    const flowMax = limits.flow_temp.max;

    let flow = clamp(toNumber(controls.flowRange?.value, appState.inputs.flow_temp), flowMin, flowMax);
    let ret = clamp(flow - delta, retMin, retMax);
    flow = clamp(ret + delta, flowMin, flowMax);
    ret = flow - delta;

    appState.inputs.return_temp = ret;
    appState.inputs.delta_t = delta;
    appState.inputs.flow_temp = flow;

    setPair(controls.flowRange, controls.flowNumber, flow, 1);
    setPair(controls.retRange, controls.retNumber, ret, 1);
    setPair(controls.dTRange, controls.dTNumber, delta, 1);
    linking = false;
    updateEfficiencyChart(undefined, { replaceCurve: false });
    if (emitUpdate) triggerUpdate();
  };

  const applyDeltaFromDelta = ({ emitUpdate = true } = {}) => {
    const delta = clamp(toNumber(controls.dTRange?.value, appState.inputs.delta_t), limits.delta_t.min, limits.delta_t.max);
    appState.inputs.delta_t = delta;
    setPair(controls.dTRange, controls.dTNumber, delta, 1);
    applyDeltaFromRet({ emitUpdate });
  };

  const applyModulation = () => {
    const mod = clamp(toNumber(controls.modRange?.value, appState.inputs.modulation_pct), limits.modulation_pct.min, limits.modulation_pct.max);
    appState.inputs.modulation_pct = mod;
    setPair(controls.modRange, controls.modNumber, mod, 1);
    updateEfficiencyChart(undefined, { replaceCurve: false });
    triggerUpdate();
  };

  const applyCv = () => {
    const range = cvRanges[appState.inputs.basis] || fallbackCvRanges[appState.inputs.basis] || fallbackCvRanges.gross;
    const value = clamp(toNumber(controls.cvRange?.value, appState.inputs.cv), range.min, range.max);
    appState.inputs.cv = value;
    setPair(controls.cvRange, controls.cvNumber, value, 1);
    updateEfficiencyChart(undefined, { replaceCurve: false });
    triggerUpdate();
  };

  const setCVUIForBasis = (basis, { keepValue = false } = {}) => {
    const range = cvRanges[basis] || fallbackCvRanges[basis] || fallbackCvRanges.gross;
    if (controls.cvRange) {
      controls.cvRange.min = range.min;
      controls.cvRange.max = range.max;
    }
    if (controls.cvNumber) {
      controls.cvNumber.min = range.min;
      controls.cvNumber.max = range.max;
    }
    if (controls.cvLabel) {
      controls.cvLabel.textContent = basis === 'gross'
        ? 'Gross calorific value (MJ/m^3)'
        : 'Net calorific value (MJ/m^3)';
    }

    const nextValue = keepValue ? clamp(appState.inputs.cv, range.min, range.max) : range.default;
    appState.inputs.cv = nextValue;
    setPair(controls.cvRange, controls.cvNumber, nextValue, 1);
  };

  const applyBasisChange = (basis) => {
    if (basis === appState.inputs.basis) return;
    appState.inputs.basis = basis;
    updateBadges(basisLabel(basis));
    setCVUIForBasis(basis);
    updateEfficiencyChart(undefined, { replaceCurve: false });
    triggerUpdate();
  };

  const applyModelChange = () => {
    appState.inputs.model = controls.model.value;
    updateEfficiencyChart(undefined, { replaceCurve: false });
    triggerUpdate();
  };

  const attachSync = (rangeEl, numberEl, handler) => {
    if (!rangeEl || !numberEl) return;
    setPct(rangeEl);
    rangeEl.addEventListener('input', () => {
      numberEl.value = rangeEl.value;
      setPct(rangeEl);
      handler();
    });
    numberEl.addEventListener('input', () => {
      rangeEl.value = numberEl.value;
      setPct(rangeEl);
      handler();
    });
  };

  const isFullViewActive = () => {
    if (!controls.chartPanel) return false;
    const isNative = document.fullscreenElement === controls.chartPanel;
    const hasClass = controls.chartPanel.classList.contains('chart-panel--expanded');
    return isNative || hasClass;
  };

  const setExpandedUI = (expanded) => {
    if (controls.chartExpandButton) {
      controls.chartExpandButton.setAttribute('aria-expanded', expanded ? 'true' : 'false');
      controls.chartExpandButton.textContent = expanded ? 'Exit full view' : 'Full view';
    }
    document.body.classList.toggle('chart-fullscreen-active', expanded);
  };

  const openFullView = () => {
    if (!controls.chartPanel) return;
    if (controls.chartPanel.requestFullscreen) {
      controls.chartPanel.requestFullscreen().then(() => {
        setExpandedUI(true);
      }).catch(() => {
        controls.chartPanel.classList.add('chart-panel--expanded');
        setExpandedUI(true);
      });
    } else {
      controls.chartPanel.classList.add('chart-panel--expanded');
      setExpandedUI(true);
    }
  };

  const closeFullView = () => {
    if (document.fullscreenElement === controls.chartPanel && document.exitFullscreen) {
      document.exitFullscreen();
    } else {
      controls.chartPanel?.classList.remove('chart-panel--expanded');
      setExpandedUI(false);
    }
  };

  attachSync(controls.retRange, controls.retNumber, () => applyDeltaFromRet());
  attachSync(controls.dTRange, controls.dTNumber, () => applyDeltaFromDelta());
  attachSync(controls.flowRange, controls.flowNumber, () => applyDeltaFromFlow());
  attachSync(controls.modRange, controls.modNumber, applyModulation);
  attachSync(controls.cvRange, controls.cvNumber, applyCv);

  if (controls.chartExpandButton) {
    controls.chartExpandButton.addEventListener('click', () => {
      if (isFullViewActive()) {
        closeFullView();
      } else {
        openFullView();
      }
    });
  }

  document.addEventListener('fullscreenchange', () => {
    const expanded = document.fullscreenElement === controls.chartPanel;
    if (!expanded) {
      controls.chartPanel?.classList.remove('chart-panel--expanded');
    }
    setExpandedUI(expanded);
  });

  if (controls.model) controls.model.addEventListener('change', applyModelChange);
  controls.basisRadios.forEach((radio) => {
    radio.addEventListener('change', (event) => {
      if (!event.target.checked) return;
      applyBasisChange(event.target.value);
    });
  });

  const applyPreset = (ret, delta, mod) => {
    setPair(controls.retRange, controls.retNumber, ret, 1);
    setPair(controls.dTRange, controls.dTNumber, delta, 1);
    appState.inputs.delta_t = delta;
    applyDeltaFromRet({ emitUpdate: false });
    setPair(controls.modRange, controls.modNumber, mod, 1);
    appState.inputs.modulation_pct = mod;
    updateEfficiencyChart(undefined, { replaceCurve: false });
    triggerUpdate();
  };

  if (controls.presetLow) controls.presetLow.addEventListener('click', () => applyPreset(30, 15, 35));
  if (controls.presetMed) controls.presetMed.addEventListener('click', () => applyPreset(40, 15, 50));
  if (controls.presetHigh) controls.presetHigh.addEventListener('click', () => applyPreset(55, 15, 80));

  setCVUIForBasis(appState.inputs.basis, { keepValue: true });
  syncControlsFromState();
  updateBadges(basisLabel(appState.inputs.basis));
  updateOutputs(appState.outputs);
  updateSweep(appState.sweep);
  updateEfficiencyChart(appState.efficiencyCurve, { replaceCurve: true });
  setExpandedUI(false);
})();