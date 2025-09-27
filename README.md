Here’s a complete **`README.md`** you can drop into the project.

---

# Heatlytics – Condensing Boiler Gas & Heat Calculator (Ideal Logic Heat H series)

**What it is**
An interactive calculator and set of ready‑to‑use Home Assistant Jinja templates that estimate **fuel input (gas power)** and **water‑side heat output** for Ideal Logic *Heat H* boilers (H12/H15/H18/H24/H30).
It models how efficiency rises sharply in condensing mode (low return temperatures) and flattens in non‑condensing mode, and it respects the manufacturer’s **min/max input and output** data.

**What it’s for**

1. Visualising how modulation, flow/return temperatures and gas basis (**Gross / Net CV**) change fuel use and delivered heat.
2. Generating *validated* Home Assistant sensors for live monitoring of **gas consumption (W)** and **heat output (W)**.

---

## Key ideas (one page)

* **Anchors from the datasheet.** The app and templates are calibrated to *Table 2 – Performance Data (Central Heating)* for the Logic Heat H range. For example on the H24:

  * **Net input (kW):** MIN 4.9, MAX 24.3; **Gross input (kW):** MIN 5.4, MAX 27.0.
  * **Water‑side output at 40 °C mean water temperature (MWT):** MIN 5.1, MAX 25.6.
  * **Water‑side output at 70 °C MWT:** MIN 4.8, MAX 24.2. 
  * Manual CVs and conversion guidance: **38.7 MJ/m³ (GCV)**, **34.9 MJ/m³ (NCV)**; m³/h = kW × 3.6 / CV. 

* **Condensing behaviour from research.** Efficiency is modelled with the **Baldi et al.** return‑temperature & load polynomial. It reproduces the steep efficiency rise below the **dew point (~56 °C)** and the gentler decline above it. We map that shape so it passes through the manufacturer’s anchors. 

* **Modulation matters.** We use the boiler’s **relative modulation** as the **gas‑side load** $L∈[0,1]$. This affects both efficiency and where we are between the datasheet’s min/max lines.

* **Gross vs Net CV.** The app lets you choose either basis. The Jinja sensors below are given **on a Net CV basis** (common for energy analysis). If you prefer Gross, swap to the Gross anchors and basis in the same framework.

---

## What the calculator shows

* **Inputs:** model (H12–H30), flow & return temperatures (with an optional **ΔT linkage**), modulation (%), and CV with **Gross/Net toggle**.
* **Outputs:** mean water temperature, whether you’re in **condensing** (<~56 °C return) or **non‑condensing** mode, min/max heat output lines, dynamic heat output (kW), efficiency (% on chosen basis), gas factor (input ÷ output), estimated **gas input (kW)** and **m³/h** using your selected CV. (See the m³/h formula in the manual.) 

---

## How the numbers are calculated

### 1) Heat‑output envelope from the datasheet

For each model we form two **linear output lines vs MWT** using the two anchor points (MWT ≈ 40 °C and 70 °C). Example for **H24**:

* `min_out_kW(MWT) = -0.01·MWT + 5.5` (5.1 kW @ 40 °C → 4.8 kW @ 70 °C)
* `max_out_kW(MWT) = -0.0467·MWT + 27.467` (25.6 kW @ 40 °C → 24.2 kW @ 70 °C)
  These numbers come directly from *Table 2*. 

With **modulation** $r$ (0→1), the instantaneous **heat output** is:

```
dyn_out_kW = min_out_kW + r · (max_out_kW − min_out_kW)
```

### 2) Efficiency surface with a condensing knee

We take Baldi’s form **η_poly(Tr, L)** (return temperature & load), which embeds a **knee near the dew point**. We evaluate it at **30 °C** and **60 °C** return and then apply a simple affine map so the curve **passes exactly through the datasheet’s Net‑CV efficiencies** at those two points, blended by load:

* At ≈ 60 °C (≈ 80/60 system): `η = output / input` ≈ 4.8/4.9 at MIN, 24.2/24.3 at MAX.
* At ≈ 30 °C (≈ 50/30 system): `η` ≈ 5.1/4.9 at MIN, 25.6/24.3 at MAX.  

This retains the **physics‑driven bend** at the dew point, but ties the scale to the boiler you own.

> **Why Net‑CV efficiency can exceed 100 %**
> On a **Net CV** basis, latent heat is not counted in the fuel’s heating value; condensing recovers part of that heat. Hence the 104–106 % region at low returns is expected—and seen in the manual’s 40 °C data. 

### 3) Fuel input and gas volume

* **Net basis:** `gas_in_kW = dyn_out_kW / η_ncv`.
* **Gross basis:** we compute `η_gcv` using the Gross anchors and then `gas_in_kW_gross = dyn_out_kW / η_gcv`.
* **m³/h:** `gas_m3h = gas_in_kW × 3.6 / CV (MJ/m³)` using your selected Gross/Net CV. 

---

## Home Assistant – example sensors

> These are the **reference templates** you can paste into HA. They are aligned with the app’s maths and calibrated to the **H24** model. Replace entity IDs to match your installation.

### 1) Gas input (Net CV, W) – condensing‑aware, modulation‑aware

```jinja
{{- "" -}}
{# ===== Dynamic boiler gas consumption (Net CV, W) with condensing efficiency & explicit load =====
   Model: Ideal Logic Heat H24
   Output: Estimated gas input power on a Net CV basis (watts)

   References:
   - Efficiency surface η(Tr, L) with coefficients a1..a8 and load L on gas side (Baldi et al., Eq. 42–43). 
   - Two calibration anchors from H24 Table 2 (Net CV): 
       ~60 °C return (~80/60):  4.8/4.9 (min), 24.2/24.3 (max)
       ~30 °C return (~50/30):  5.1/4.9 (min), 25.6/24.3 (max)
   - Dew-point transition around 56 °C return; condensing efficiency improves rapidly below this point.
   Method:
   1) Compute dynamic HEAT OUTPUT from modulation between min/max output lines (vs mean water temp).
   2) Set gas-side load L directly from relative modulation (0→1).
   3) Evaluate Baldi efficiency shape η_poly(Tr, L); map it affinely so it passes through the H24 Net‑CV anchors at ~60 °C and ~30 °C
      for the current L.
   4) Net gas input (W) = HEAT_OUTPUT_W / η_ncv.
#}

{# --- Live inputs --- #}
{% set modulation = states('sensor.opentherm_gateway_otgw2_otgw2_relative_modulation_level') | float(0) %}
{% set t_flow    = states('sensor.opentherm_gateway_otgw2_otgw2_boiler_flow_water_temperature') | float(0) %}
{% set t_return  = states('sensor.opentherm_gateway_otgw2_otgw2_return_water_temperature') | float(0) %}
{% set mean_temp = (t_flow + t_return) / 2 %}

{# --- Gas-side load (use OpenTherm relative modulation as load L \in [0,1]) --- #}
{% set L = (modulation / 100) %}
{% set L = [0, [L, 1] | min] | max %}

{# --- Min/Max HEAT OUTPUT lines vs mean water temperature (kW), from H24 Table 2 --- #}
{#     5.1 kW @ 40 °C → 4.8 kW @ 70 °C (MIN) ; 25.6 → 24.2 (MAX) #}
{% set min_out_kW = (-0.01   * mean_temp + 5.5) %}
{% set max_out_kW = (-0.0467 * mean_temp + 27.467) %}
{% set min_out_W = min_out_kW * 1000 %}
{% set max_out_W = max_out_kW * 1000 %}

{# --- Dynamic HEAT OUTPUT from modulation (W) --- #}
{% set FINAL_OUTPUT_W = (max_out_W - min_out_W) * L + min_out_W %}

{# --- Baldi efficiency surface (fraction) η_poly(Tr, L); Tr = return temperature --- #}
{#     a1..a8 are from the identified polynomial; dew-point kink ~56 °C is inherent in the dataset they fit. #}
{% set a1 = 8.841   %}
{% set a2 = -0.2564 %}
{% set a3 = 0.003945 %}
{% set a4 = -0.000017983 %}
{% set a5 = 12.024  %}
{% set a6 = 0.2710  %}
{% set a7 = 0.001230 %}
{% set a8 = 7.147   %}

{% set Tr = t_return %}
{% set Tr2 = Tr * Tr %}
{% set Tr3 = Tr2 * Tr %}
{% set Tr4 = Tr3 * Tr %}
{% set eta_poly = (a1*Tr + a2*Tr2 + a3*Tr3 + a4*Tr4 + a5*L + a6*Tr*L + a7*Tr2*L + a8) / 100 %}

{# --- Evaluate the same shape at two calibration returns: ~60 °C (non‑condensing) and ~30 °C (deep condensing) --- #}
{% set t60 = 60 %}{% set t30 = 30 %}
{% set t60_2 = t60 * t60 %}{% set t60_3 = t60_2 * t60 %}{% set t60_4 = t60_3 * t60 %}
{% set t30_2 = t30 * t30 %}{% set t30_3 = t30_2 * t30 %}{% set t30_4 = t30_3 * t30 %}
{% set eta60_poly = (a1*t60 + a2*t60_2 + a3*t60_3 + a4*t60_4 + a5*L + a6*t60*L + a7*t60_2*L + a8) / 100 %}
{% set eta30_poly = (a1*t30 + a2*t30_2 + a3*t30_3 + a4*t30_4 + a5*L + a6*t30*L + a7*t30_2*L + a8) / 100 %}

{# --- Manufacturer NET‑CV anchor efficiencies η = output / net input, blended by gas‑load L --- #}
{% set eta60_min = 4.8 / 4.9 %}
{% set eta60_max = 24.2 / 24.3 %}
{% set eta30_min = 5.1 / 4.9 %}
{% set eta30_max = 25.6 / 24.3 %}
{% set eta60_target = eta60_min + (eta60_max - eta60_min) * L %}
{% set eta30_target = eta30_min + (eta30_max - eta30_min) * L %}

{# --- Affine calibration: map η_poly so it passes through η60_target and η30_target for current L --- #}
{% set den = (eta30_poly - eta60_poly) %}
{% if den | abs < 1e-9 %}
  {% set slope = 0 %}
{% else %}
  {% set slope = (eta30_target - eta60_target) / den %}
{% endif %}
{% set offset = eta60_target - slope * eta60_poly %}
{% set eta_ncv_raw = slope * eta_poly + offset %}

{# --- Sanity clamps for NET CV efficiency: 90% ≤ η ≤ 111% (theoretical upper bound for NCV basis) --- #}
{% set eta_ncv = [ [ eta_ncv_raw, 0.90 ] | max, 1.11 ] | min %}

{# --- Final GAS INPUT (Net CV, W) = HEAT_OUTPUT_W / η_ncv --- #}
{% if states('binary_sensor.opentherm_gateway_otgw2_otgw2_flame') != 'on' %}
  0
{% else %}
  {{ (FINAL_OUTPUT_W / eta_ncv) | round(0) }}
{% endif %}
```

### 2) Heat output (W) – symmetric to the gas‑input sensor

```jinja
{{- "" -}}
{# ===== Dynamic HEAT OUTPUT (W, Net CV basis), symmetry with gas-input template =====
   Model: Ideal Logic Heat H24
   Output: Estimated heat delivered to water circuit (watts).

   Method:
   • Gas-side load L from OpenTherm relative modulation (0→1).
   • Net-CV efficiency η_ncv(Tr, L) from Baldi et al. polynomial (return-led + load),
     affinely mapped to pass the manufacturer H24 Net-CV anchors for ~60 °C and ~30 °C return
     at the current L (MIN/MAX blended by L).  [See Baldi 2017, Fig. 2 (dew-point ~56 °C),
     eq. (42) and coefficients (43).]
   • Gas input (kW, NCV) from H24 Table 2: MIN 4.9, MAX 24.3; interpolate by L.
   • Heat output (W) = gas_in_kW * 1000 * η_ncv.

   Notes:
   • This makes the HEAT OUTPUT sensor the exact “mirror” of your Net-CV gas-input sensor.
   • If flame is off, return 0.
#}

{# --- Live inputs --- #}
{% set modulation = states('sensor.opentherm_gateway_otgw2_otgw2_relative_modulation_level') | float(0) %}
{% set t_return  = states('sensor.opentherm_gateway_otgw2_otgw2_return_water_temperature') | float(0) %}

{# --- Gas-side load from modulation --- #}
{% set L = (modulation / 100) %}
{% set L = [0, [L, 1] | min] | max %}

{# --- Baldi polynomial (fraction) η_poly(Tr, L) --- #}
{% set a1 = 8.841   %}
{% set a2 = -0.2564 %}
{% set a3 =  0.003945 %}
{% set a4 = -0.000017983 %}
{% set a5 = 12.024  %}
{% set a6 =  0.2710  %}
{% set a7 =  0.001230 %}
{% set a8 =  7.147   %}

{% set Tr  = t_return %}
{% set Tr2 = Tr * Tr %}
{% set Tr3 = Tr2 * Tr %}
{% set Tr4 = Tr3 * Tr %}
{% set eta_poly = (a1*Tr + a2*Tr2 + a3*Tr3 + a4*Tr4 + a5*L + a6*Tr*L + a7*Tr2*L + a8) / 100 %}

{# Evaluate at ~60 °C and ~30 °C for mapping #}
{% set t60 = 60 %}{% set t30 = 30 %}
{% set t60_2 = t60 * t60 %}{% set t60_3 = t60_2 * t60 %}{% set t60_4 = t60_3 * t60 %}
{% set t30_2 = t30 * t30 %}{% set t30_3 = t30_2 * t30 %}{% set t30_4 = t30_3 * t30 %}
{% set eta60_poly = (a1*t60 + a2*t60_2 + a3*t60_3 + a4*t60_4 + a5*L + a6*t60*L + a7*t60_2*L + a8) / 100 %}
{% set eta30_poly = (a1*t30 + a2*t30_2 + a3*t30_3 + a4*t30_4 + a5*L + a6*t30*L + a7*t30_2*L + a8) / 100 %}

{# --- H24 Net‑CV anchor efficiencies (output / net input), blended by load L --- #}
{% set eta60_min = 4.8  / 4.9  %}  {# ~80/60, MIN #}
{% set eta60_max = 24.2 / 24.3 %}  {# ~80/60, MAX #}
{% set eta30_min = 5.1  / 4.9  %}  {# ~50/30, MIN #}
{% set eta30_max = 25.6 / 24.3 %}  {# ~50/30, MAX #}
{% set eta60_target = eta60_min + (eta60_max - eta60_min) * L %}
{% set eta30_target = eta30_min + (eta30_max - eta30_min) * L %}

{# --- Affine calibration of η_poly to pass through anchors for current L --- #}
{% set den = (eta30_poly - eta60_poly) %}
{% if den | abs < 1e-9 %}
  {% set slope = 0 %}
{% else %}
  {% set slope = (eta30_target - eta60_target) / den %}
{% endif %}
{% set offset = eta60_target - slope * eta60_poly %}
{% set eta_ncv_raw = slope * eta_poly + offset %}

{# --- Clamp within physically sensible Net‑CV bounds (≈90–111%) --- #}
{% set eta_ncv = [ [ eta_ncv_raw, 0.90 ] | max, 1.11 ] | min %}

{# --- Gas input (kW, Net‑CV) from modulation between 4.9→24.3 --- #}
{% set net_in_min = 4.9 %}
{% set net_in_max = 24.3 %}
{% set gas_in_kW = net_in_min + (net_in_max - net_in_min) * L %}

{# --- Final: HEAT OUTPUT (W) = gas_in_kW * 1000 * η_ncv --- #}
{% if states('binary_sensor.opentherm_gateway_otgw2_otgw2_flame') != 'on' %}
  0
{% else %}
  {{ (gas_in_kW * 1000 * eta_ncv) | round(0) }}
{% endif %}
```

> **Tip:** If you want a **Gross** version of the gas sensor, use the same structure but replace the Net anchors with the **Gross input** anchors from Table 2 and clamp to a sensible Gross range (≈ 86–99.5 %). 

---

## Running the web app

```bash
# Python ≥3.10
pip install -r requirements.txt
flask --app app.py run  # or however your entrypoint is named
```

* Use **Gross/Net** toggle to change basis for efficiency anchoring and m³/h calculation.
* Use the **ΔT slider** to link flow and return: moving one will adjust the other to maintain ΔT (you can break the link by moving both independently).

---

## Validating against the datasheet

* Set **return ≈ 60 °C**, **MWT ≈ 70 °C** (e.g. flow 80 °C / return 60 °C).

  * At **low modulation**, water‑side output and (Net) efficiency should be near **4.8 kW** and **~98 %**; at **high modulation**, near **24.2 kW** and **~99.6 %**. 
* Set **return ≈ 30 °C**, **MWT ≈ 40 °C** (e.g. flow 50 °C / return 30 °C).

  * Expect outputs ~**5.1 kW** (min) and **25.6 kW** (max) with Net‑CV efficiencies ≈ **104–106 %**. 
* Observe the **knee near 56 °C return** as per Baldi’s figure and discussion. 

---

## Known assumptions / limitations

* **Anchors** are static (from Table 2); real installations vary with gas quality, hydraulics, air‑fuel ratio, flue conditions, etc.
* **Baldi model** captures the condensing knee but is still a simplified regression; we calibrate scale to two points (30 °C & 60 °C) so intermediate returns are interpolated rather than lab‑tested. 
* Electricity used by pumps/fans is not included in heat output; standby is ignored.
* Ensure your **OpenTherm entities** (flow/return/modulation) are stable; sensor noise will move the instantaneous estimates.

---

## References

* **Ideal Logic Heat H – Installation & Servicing Manual (2018)**: Table 2 performance data (min/max input and output) and CV guidance for gas m³/h conversion.  
* **Baldi, S. et al. (2017)** *Energy Conversion and Management* 136:329–339 – condensing boiler efficiency dependence on **return temperature** with a dew‑point knee and a polynomial/load model used here for shape. 

---

## Why these results look “right”

* At **low returns** (e.g. ~30 °C), Net‑CV efficiency >100 % is **expected** because recovered latent heat isn’t counted in NCV. The manual’s 40 °C data show exactly that trend for the H24. 
* At **returns above ~56 °C**, condensate stops forming and the curve flattens; the model reproduces this with the dew‑point knee seen in the literature. 

---

### Licence & contributions

MIT. Issues and PRs welcome. Please include your boiler model, CV basis (Gross/Net), and a short description of your system (ΔT, set‑points, weather, etc.) when reporting results.

---
