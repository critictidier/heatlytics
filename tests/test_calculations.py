import pytest

from heatlytics_app.calculations import calculate, normalize_inputs, sweep


def test_default_calculation_matches_expected_outputs():
    result = calculate({})
    outputs = result["outputs"]

    assert outputs["mwt"] == pytest.approx(37.5, rel=1e-6)
    assert outputs["return_temp"] == pytest.approx(30.0, rel=1e-6)
    assert outputs["flow_temp"] == pytest.approx(45.0, rel=1e-6)
    assert outputs["condensing_mode"] == "CONDENSING"
    assert outputs["basis_label"] == "Gross (GCV)"
    assert outputs["min_kW"] == pytest.approx(5.125, rel=1e-6)
    assert outputs["max_kW"] == pytest.approx(25.7166666667, rel=1e-9)
    assert outputs["dyn_kW"] == pytest.approx(13.2808, rel=1e-4)
    assert outputs["efficiency_pct"] == pytest.approx(94.5925925926, rel=1e-9)
    assert outputs["gas_factor"] == pytest.approx(1.0571652310, rel=1e-9)
    assert outputs["gas_kW"] == pytest.approx(14.1254894283, rel=1e-8)
    assert outputs["m3h"] == pytest.approx(1.3139990166, rel=1e-9)
    assert outputs["m3h_label"].endswith("@ GCV)")


    curve = result["efficiency_curve"]
    assert curve["dew_point"] == pytest.approx(56.0, rel=1e-9)
    assert curve["points"][0]["return_temp"] == pytest.approx(20.0, rel=1e-9)
    assert curve["points"][-1]["return_temp"] == pytest.approx(80.0, rel=1e-9)

    eff_low = next(pt for pt in curve["points"] if abs(pt["return_temp"] - 30.0) <= 1e-9)
    eff_high = next(pt for pt in curve["points"] if abs(pt["return_temp"] - 70.0) <= 1e-9)
    assert eff_low["efficiency_pct"] > eff_high["efficiency_pct"]


def test_net_basis_adjusts_efficiency_and_gas_use():
    result = calculate({"basis": "net", "cv": 34.9})
    outputs = result["outputs"]

    assert outputs["basis_label"] == "Net (NCV)"
    assert outputs["efficiency_pct"] == pytest.approx(104.5888972873, rel=1e-9)
    assert outputs["gas_kW"] == pytest.approx(12.7754159507, rel=1e-9)
    assert outputs["m3h_label"].endswith("@ NCV)")


def test_normalize_inputs_maintains_flow_delta_relationship():
    data = normalize_inputs({"return_temp": 70, "delta_t": 20, "flow_temp": 75})
    assert data["return_temp"] == pytest.approx(60.0, rel=1e-6)
    assert data["flow_temp"] == pytest.approx(80.0, rel=1e-6)
    assert data["flow_temp"] == pytest.approx(data["return_temp"] + data["delta_t"], rel=1e-6)


def test_sweep_includes_all_modulation_steps():
    items = sweep({"model": "H18", "return_temp": 45, "delta_t": 15, "basis": "gross"})
    assert len(items) == 11
    assert items[0]["modulation_pct"] == 0
    assert items[-1]["modulation_pct"] == 100
    assert items[0]["dyn_kW"] == pytest.approx(4.9861816083, rel=1e-9)
    assert items[-1]["gas_kW"] == pytest.approx(20.0675911568, rel=1e-9)