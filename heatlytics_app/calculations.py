from __future__ import annotations

from dataclasses import dataclass
from typing import Any, TypedDict


class ModelDefinition(TypedDict):
    min40: float
    min70: float
    max40: float
    max70: float
    netMin: float
    netMax: float
    grossMin: float
    grossMax: float


MODELS: dict[str, ModelDefinition] = {
    "H12": {"min40": 5.1, "min70": 4.8, "max40": 13.0, "max70": 12.0, "netMin": 4.9, "netMax": 12.1, "grossMin": 5.4, "grossMax": 13.4},
    "H15": {"min40": 5.1, "min70": 4.8, "max40": 15.9, "max70": 15.0, "netMin": 4.9, "netMax": 15.1, "grossMin": 5.4, "grossMax": 16.6},
    "H18": {"min40": 5.1, "min70": 4.8, "max40": 19.1, "max70": 18.0, "netMin": 4.9, "netMax": 18.1, "grossMin": 5.4, "grossMax": 20.1},
    "H24": {"min40": 5.1, "min70": 4.8, "max40": 25.6, "max70": 24.2, "netMin": 4.9, "netMax": 24.3, "grossMin": 5.4, "grossMax": 27.0},
    "H30": {"min40": 6.4, "min70": 6.1, "max40": 31.0, "max70": 30.3, "netMin": 6.1, "netMax": 30.4, "grossMin": 6.7, "grossMax": 33.7},
}

A_COEFFICIENTS = {
    "a1": 8.841,
    "a2": -0.2564,
    "a3": 0.003945,
    "a4": -0.000017983,
    "a5": 12.024,
    "a6": 0.2710,
    "a7": 0.001230,
    "a8": 7.147,
}

CV_RANGES = {
    "gross": {"min": 36.0, "max": 41.0, "default": 38.7},
    "net": {"min": 33.0, "max": 37.0, "default": 34.9},
}

MODEL_OPTIONS = [
    {"value": "H24", "label": "Heat H 24"},
    {"value": "H12", "label": "Heat H 12"},
    {"value": "H15", "label": "Heat H 15"},
    {"value": "H18", "label": "Heat H 18"},
    {"value": "H30", "label": "Heat H 30"},
]

BASIS_OPTIONS = [
    {"value": "gross", "label": "Gross (GCV)"},
    {"value": "net", "label": "Net (NCV)"},
]

RET_RANGE = (20.0, 80.0)
FLOW_RANGE = (20.0, 80.0)
DELTA_RANGE = (2.0, 30.0)
MOD_RANGE = (0.0, 100.0)
SWEEP_STEPS = [0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100]

DEFAULT_MODEL = "H24"
EFFICIENCY_TEMP_STEP = 1.0
DEW_POINT_C = 56.0

DEFAULT_BASIS = "gross"
DEFAULT_INPUTS: dict[str, Any] = {
    "model": DEFAULT_MODEL,
    "basis": DEFAULT_BASIS,
    "return_temp": 30.0,
    "delta_t": 15.0,
    "flow_temp": 45.0,
    "modulation_pct": 40.0,
    "cv": CV_RANGES[DEFAULT_BASIS]["default"],
}

LIMITS = {
    "return_temp": {"min": RET_RANGE[0], "max": RET_RANGE[1]},
    "flow_temp": {"min": FLOW_RANGE[0], "max": FLOW_RANGE[1]},
    "delta_t": {"min": DELTA_RANGE[0], "max": DELTA_RANGE[1]},
    "modulation_pct": {"min": MOD_RANGE[0], "max": MOD_RANGE[1]},
}


@dataclass
class ModelResult:
    mwt: float
    min_kW: float
    max_kW: float
    dyn_kW: float
    dyn_line_kW: float
    eta: float
    gas_factor: float
    gas_kW: float
    m3h: float


def clamp(value: float, low: float, high: float) -> float:
    return max(low, min(high, value))


def _eta_poly(return_temp: float, load: float) -> float:
    t2 = return_temp * return_temp
    t3 = t2 * return_temp
    t4 = t3 * return_temp
    coeffs = A_COEFFICIENTS
    pct = (
        coeffs["a1"] * return_temp
        + coeffs["a2"] * t2
        + coeffs["a3"] * t3
        + coeffs["a4"] * t4
        + coeffs["a5"] * load
        + coeffs["a6"] * return_temp * load
        + coeffs["a7"] * t2 * load
        + coeffs["a8"]
    )
    return pct / 100.0


def _anchor_effs(model_id: str, basis: str) -> dict[str, float]:
    model = MODELS[model_id]
    if basis == "gross":
        return {
            "eta60_min": model["min70"] / model["grossMin"],
            "eta60_max": model["max70"] / model["grossMax"],
            "eta30_min": model["min40"] / model["grossMin"],
            "eta30_max": model["max40"] / model["grossMax"],
        }
    return {
        "eta60_min": model["min70"] / model["netMin"],
        "eta60_max": model["max70"] / model["netMax"],
        "eta30_min": model["min40"] / model["netMin"],
        "eta30_max": model["max40"] / model["netMax"],
    }


def _eta_calibrated(model_id: str, return_temp: float, load: float, basis: str) -> float:
    anchors = _anchor_effs(model_id, basis)
    eta60_target = anchors["eta60_min"] + (anchors["eta60_max"] - anchors["eta60_min"]) * load
    eta30_target = anchors["eta30_min"] + (anchors["eta30_max"] - anchors["eta30_min"]) * load

    eta60_poly = _eta_poly(60.0, load)
    eta30_poly = _eta_poly(30.0, load)

    denominator = eta30_poly - eta60_poly
    if abs(denominator) < 1e-9:
        slope = 0.0
    else:
        slope = (eta30_target - eta60_target) / denominator
    offset = eta60_target - slope * eta60_poly

    eta = slope * _eta_poly(return_temp, load) + offset
    eta = clamp(eta, 0.86, 0.995) if basis == "gross" else clamp(eta, 0.90, 1.11)
    return eta


def _output_lines(model_id: str, mean_water_temp: float) -> tuple[float, float]:
    model = MODELS[model_id]
    min_slope = (model["min70"] - model["min40"]) / 30.0
    max_slope = (model["max70"] - model["max40"]) / 30.0
    min_kW = model["min40"] + min_slope * (mean_water_temp - 40.0)
    max_kW = model["max40"] + max_slope * (mean_water_temp - 40.0)
    return min_kW, max_kW


def _gas_input_from_lines(model_id: str, load: float, basis: str) -> float:
    model = MODELS[model_id]
    if basis == "gross":
        low, high = model["grossMin"], model["grossMax"]
    else:
        low, high = model["netMin"], model["netMax"]
    return low + (high - low) * load


def _basis_label(basis: str) -> str:
    return "Gross (GCV)" if basis == "gross" else "Net (NCV)"


def _model_calcs(model_id: str, flow_temp: float, return_temp: float, modulation_pct: float, cv: float, basis: str) -> ModelResult:
    mean_water_temp = (flow_temp + return_temp) / 2.0
    min_kW, max_kW = _output_lines(model_id, mean_water_temp)

    load = clamp(modulation_pct / 100.0, 0.0, 1.0)
    eta = _eta_calibrated(model_id, return_temp, load, basis)
    gas_factor = 1.0 / eta if eta else float("inf")

    gas_in_from_lines = _gas_input_from_lines(model_id, load, basis)
    dyn_heat_from_gas = gas_in_from_lines * eta

    dyn_heat_from_lines = min_kW + load * (max_kW - min_kW)
    gas_in_from_output = dyn_heat_from_lines * gas_factor
    m3_per_hour = gas_in_from_output * 3.6 / cv if cv else 0.0

    return ModelResult(
        mwt=mean_water_temp,
        min_kW=min_kW,
        max_kW=max_kW,
        dyn_kW=dyn_heat_from_gas,
        dyn_line_kW=dyn_heat_from_lines,
        eta=eta,
        gas_factor=gas_factor,
        gas_kW=gas_in_from_output,
        m3h=m3_per_hour,
    )


def _as_float(value: Any, default: float) -> float:
    try:
        if value is None or (isinstance(value, str) and not value.strip()):
            raise ValueError
        return float(value)
    except (TypeError, ValueError):
        return float(default)


def normalize_inputs(raw: dict[str, Any]) -> dict[str, Any]:
    inputs = dict(DEFAULT_INPUTS)

    model = str(raw.get("model", inputs["model"]))
    if model not in MODELS:
        model = DEFAULT_MODEL
    basis = str(raw.get("basis", inputs["basis"]))
    if basis not in CV_RANGES:
        basis = DEFAULT_BASIS

    ret = _as_float(raw.get("return_temp"), inputs["return_temp"])
    delta_t = _as_float(raw.get("delta_t"), inputs["delta_t"])
    flow = _as_float(raw.get("flow_temp"), inputs["flow_temp"])
    modulation = _as_float(raw.get("modulation_pct"), inputs["modulation_pct"])

    ret = clamp(ret, *RET_RANGE)
    delta_t = clamp(delta_t, *DELTA_RANGE)

    # Re-establish flow = return + delta, respecting bounds.
    flow = clamp(ret + delta_t, *FLOW_RANGE)
    ret = clamp(flow - delta_t, *RET_RANGE)
    flow = clamp(ret + delta_t, *FLOW_RANGE)

    modulation = clamp(modulation, *MOD_RANGE)

    cv_default = CV_RANGES[basis]["default"]
    cv = clamp(_as_float(raw.get("cv"), cv_default), CV_RANGES[basis]["min"], CV_RANGES[basis]["max"])

    inputs.update(
        {
            "model": model,
            "basis": basis,
            "return_temp": ret,
            "delta_t": delta_t,
            "flow_temp": flow,
            "modulation_pct": modulation,
            "cv": cv,
        }
    )
    return inputs


def _format_outputs(result: ModelResult, inputs: dict[str, Any]) -> dict[str, Any]:
    condensing_mode = "CONDENSING" if inputs["return_temp"] < 56.0 else "NON-CONDENSING"
    basis_label = _basis_label(inputs["basis"])
    m3h_label = f"Estimated gas use (m^3/h @ {'GCV' if inputs['basis'] == 'gross' else 'NCV'})"

    return {
        "mwt": result.mwt,
        "return_temp": inputs["return_temp"],
        "flow_temp": inputs["flow_temp"],
        "condensing_mode": condensing_mode,
        "basis_label": basis_label,
        "min_kW": result.min_kW,
        "max_kW": result.max_kW,
        "dyn_kW": result.dyn_kW,
        "efficiency_pct": result.eta * 100.0,
        "gas_factor": result.gas_factor,
        "gas_kW": result.gas_kW,
        "m3h": result.m3h,
        "m3h_label": m3h_label,
    }


def _build_sweep(inputs: dict[str, Any]) -> list[dict[str, Any]]:
    results: list[dict[str, Any]] = []
    for step in SWEEP_STEPS:
        res = _model_calcs(
            inputs["model"],
            inputs["flow_temp"],
            inputs["return_temp"],
            float(step),
            inputs["cv"],
            inputs["basis"],
        )
        results.append(
            {
                "modulation_pct": step,
                "dyn_kW": res.dyn_kW,
                "efficiency_pct": res.eta * 100.0,
                "gas_factor": res.gas_factor,
                "gas_kW": res.gas_kW,
                "m3h": res.m3h,
            }
        )
    return results


def _efficiency_curve(inputs: dict[str, Any]) -> list[dict[str, float]]:
    start, end = RET_RANGE
    step = EFFICIENCY_TEMP_STEP
    load = clamp(inputs["modulation_pct"] / 100.0, 0.0, 1.0)
    basis = inputs["basis"]
    model_id = inputs["model"]

    points: list[dict[str, float]] = []
    count = int((end - start) / step) + 1
    for idx in range(count + 1):
        temp = start + idx * step
        if temp > end + 1e-9:
            break
        eta = _eta_calibrated(model_id, temp, load, basis)
        points.append({
            "return_temp": round(temp, 4),
            "efficiency_pct": eta * 100.0,
        })
    return points


def calculate(raw_inputs: dict[str, Any]) -> dict[str, Any]:
    inputs = normalize_inputs(raw_inputs)
    result = _model_calcs(
        inputs["model"],
        inputs["flow_temp"],
        inputs["return_temp"],
        inputs["modulation_pct"],
        inputs["cv"],
        inputs["basis"],
    )
    outputs = _format_outputs(result, inputs)
    sweep_data = _build_sweep(inputs)
    efficiency_curve = _efficiency_curve(inputs)
    return {
        "inputs": inputs,
        "outputs": outputs,
        "sweep": sweep_data,
        "efficiency_curve": {
            "points": efficiency_curve,
            "dew_point": DEW_POINT_C,
        },
    }


def sweep(raw_inputs: dict[str, Any]) -> list[dict[str, Any]]:
    inputs = normalize_inputs(raw_inputs)
    return _build_sweep(inputs)


def initial_state() -> dict[str, Any]:
    defaults = normalize_inputs(DEFAULT_INPUTS)
    initial = calculate(defaults)
    state = {
        "inputs": initial["inputs"],
        "model_options": MODEL_OPTIONS,
        "basis_options": BASIS_OPTIONS,
        "cv_ranges": CV_RANGES,
        "limits": LIMITS,
        "outputs": initial["outputs"],
        "sweep": initial["sweep"],
        "efficiency_curve": initial["efficiency_curve"],
    }
    return state
