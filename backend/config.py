import os
from pathlib import Path

DATA_DIR = Path(
    os.environ.get(
        "DATA_DIR",
        r"C:\Users\Mellow_labs\Desktop\Mellow_labs_Financials_backup_29-04-26",
    )
)

SHEET_MAP = {
    "youtube_adsense": DATA_DIR / "Mellow_labs_Financials_V5 - YouTube AdSense.csv",
    "patreon":         DATA_DIR / "Mellow_labs_Financials_V5 - Paitron.csv",
    "sponsorships":    DATA_DIR / "Mellow_labs_Financials_V5 - Sponsorships.csv",
    "other_income":    DATA_DIR / "Mellow_labs_Financials_V5 - Other_income.csv",
    "amazon":          DATA_DIR / "Mellow_labs_Financials_V5 - Amazon.csv",
    "ebay":            DATA_DIR / "Mellow_labs_Financials_V5 - Ebay.csv",
    "aliexpress":      DATA_DIR / "Mellow_labs_Financials_V5 - aliexpress.csv",
    "other_expenses":  DATA_DIR / "Mellow_labs_Financials_V5 - other.csv",
}

SHEET_META = {
    "youtube_adsense": {"label": "YouTube AdSense", "category": "income"},
    "patreon":         {"label": "Patreon",          "category": "income"},
    "sponsorships":    {"label": "Sponsorships",     "category": "income"},
    "other_income":    {"label": "Other Income",     "category": "income"},
    "amazon":          {"label": "Amazon",           "category": "expense"},
    "ebay":            {"label": "eBay",             "category": "expense"},
    "aliexpress":      {"label": "AliExpress",       "category": "expense"},
    "other_expenses":  {"label": "Other Expenses",   "category": "expense"},
}

SPONSOR_CSV   = DATA_DIR / "Sponsor Tracker - Sponserd videos.csv"
SETTINGS_FILE = DATA_DIR / "settings.json"

INCOME_SOURCES  = ["YouTube AdSense", "Patreon", "Sponsorships", "Other Income"]
EXPENSE_SOURCES = ["Amazon", "eBay", "AliExpress", "Other Expenses"]

SUMMARY_COLUMNS = (
    INCOME_SOURCES + ["Total Income"] +
    EXPENSE_SOURCES + ["Total Expenses", "Net"]
)
