"""
Philippine public holiday calendar for the is_holiday feature.

IMPORTANT — read before deploying:
The Philippines announces "additional special non-working days" via
Presidential Proclamation, often only months in advance, and sometimes
moves a holiday to create a long weekend ("holiday economics"). This
list is NOT something you write once and forget — it is exactly the
kind of reference data that goes stale silently (see the Production
Reality Check on feature engineering from our pipeline walkthrough).

Treat this list as data to update at least once a year, ideally each
December for the following year, by checking the official Malacañang
Proclamation list. A stale holiday list quietly degrades one of your
model's top-3 most important features with no error thrown.

Dates below cover the training window in the paper (Jul 2025 – Jul 2026)
plus regular (non-moving) holidays for the following year as a starting
point. VERIFY against the actual Proclamation before using in production.
"""
from datetime import date

# Regular + special non-working holidays, Philippines
# Source to check yearly: https://www.officialgazette.gov.ph
PH_HOLIDAYS = {
    # 2025
    date(2025, 1, 1),    # New Year's Day
    date(2025, 4, 1),    # Eid'l Fitr (movable, verify)
    date(2025, 4, 9),    # Araw ng Kagitingan
    date(2025, 4, 17),   # Maundy Thursday
    date(2025, 4, 18),   # Good Friday
    date(2025, 5, 1),    # Labor Day
    date(2025, 6, 6),    # Eid'l Adha (movable, verify)
    date(2025, 6, 12),   # Independence Day
    date(2025, 8, 21),   # Ninoy Aquino Day
    date(2025, 8, 25),   # National Heroes Day
    date(2025, 11, 1),   # All Saints' Day
    date(2025, 11, 30),  # Bonifacio Day
    date(2025, 12, 8),   # Immaculate Conception
    date(2025, 12, 25),  # Christmas Day
    date(2025, 12, 30),  # Rizal Day
    date(2025, 12, 31),  # Last Day of the Year

    # 2026 — verify against the official Proclamation once published
    date(2026, 1, 1),
    date(2026, 4, 2),    # Maundy Thursday (estimate, verify)
    date(2026, 4, 3),    # Good Friday (estimate, verify)
    date(2026, 4, 9),
    date(2026, 5, 1),
    date(2026, 6, 12),
    date(2026, 8, 21),
    date(2026, 8, 31),   # National Heroes Day (last Mon of Aug, estimate)
    date(2026, 11, 1),
    date(2026, 11, 30),
    date(2026, 12, 8),
    date(2026, 12, 25),
    date(2026, 12, 30),
}


def is_holiday(d: date) -> int:
    """Return 1 if the given date is a Philippine public holiday, else 0."""
    return 1 if d in PH_HOLIDAYS else 0
