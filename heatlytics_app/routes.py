from flask import Blueprint, jsonify, render_template, request

from . import calculations


bp = Blueprint("main", __name__)


@bp.get("/")
def index() -> str:
    state = calculations.initial_state()
    return render_template("index.html", initial_state=state)


@bp.post("/api/calculate")
def api_calculate():
    payload = request.get_json(silent=True) or {}
    result = calculations.calculate(payload)
    return jsonify(result)


@bp.post("/api/sweep")
def api_sweep():
    payload = request.get_json(silent=True) or {}
    data = calculations.sweep(payload)
    return jsonify({"items": data})