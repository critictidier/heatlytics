# Heatlytics Boiler Calculator (Flask)

This project ports the original `app.html` heat calculator into a Flask web application so the boiler performance model can be hosted as a proper web app. The UI retains the glass look and behaviour of the single-page version while the core maths are implemented in Python for testability.

## Features
- Flask app factory with blueprint routing and JSON endpoints (`/api/calculate`, `/api/sweep`).
- Pure-Python port of the Ideal Logic Heat H calculations with symmetry between gas-in and heat-out lines.
- UI served with Jinja templates and static assets; JavaScript keeps the live slider experience and talks to the Flask API.
- Interactive efficiency chart (Chart.js) showing the Baldi et al. return-temperature curve, with the 56�C dew-point transition highlighted.
- Unit tests (pytest) covering the calculator logic, input normalisation, and sweep table generation.

![Heatlytics screenshot](Screenshot_27-9-2025_14100_127.0.0.1.jpeg)

## Getting Started
1. **Set up a virtual environment (recommended):**
   ```bash
   python -m venv .venv
   .venv\Scripts\activate  # Windows
   # or
   source .venv/bin/activate  # macOS/Linux
   ```
2. **Install dependencies:**
   ```bash
   pip install -r requirements.txt
   ```
3. **Run the development server:**
   ```bash
   flask --app app run --debug
   ```
   The app will be available at http://127.0.0.1:5000/.

## Tests
Run the calculator tests with:
```bash
pytest
```

## Project Layout
```
heatlytics_app/
  __init__.py      # Flask app factory
  calculations.py  # Python implementation of the model
  config.py        # Base/derived config classes
  routes.py        # Blueprint with UI + API routes
  static/
    css/styles.css # UI styling copied from the original app
    js/app.js      # Browser logic using the Flask API
  templates/
    base.html      # Shared layout
    index.html     # Calculator page
```

The original `app.html` is left untouched for reference. The Flask port sources the same maths, with added validation and tests to keep future changes safe.
