# app/utils/date_features.py
from datetime import date
import calendar

def is_payday(check_date: date) -> bool:
    last_day_of_month = calendar.monthrange(check_date.year, check_date.month)[1]
    return check_date.day == 15 or check_date.day == last_day_of_month