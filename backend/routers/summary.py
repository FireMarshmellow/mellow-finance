from datetime import date

from fastapi import APIRouter, HTTPException

from services.loader import load_all
from services.normaliser import normalise_all
from services.aggregator import get_yearly_summary, get_monthly_summary, get_range_summary

router = APIRouter(prefix="/api/summary", tags=["summary"])


def _canonical():
    return normalise_all(load_all())


@router.get("/yearly")
def yearly_summary():
    return get_yearly_summary(_canonical())


@router.get("/monthly")
def monthly_summary():
    return get_monthly_summary(_canonical())


@router.get("/range")
def range_summary(start: date, end: date):
    if start > end:
        raise HTTPException(status_code=422, detail="start must be on or before end")
    return get_range_summary(_canonical(), start, end)
