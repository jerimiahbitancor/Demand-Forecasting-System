# app/models/database.py
from sqlalchemy import Column, Integer, String, Numeric, Date, DateTime, Boolean, ForeignKey, Text, UniqueConstraint
from sqlalchemy.orm import declarative_base, relationship
from sqlalchemy.sql import func

Base = declarative_base()

# ============================================
# AUTHENTICATION
# ============================================
class User(Base):
    """Single shared account. Expected to hold exactly one row."""
    __tablename__ = "users"
    id = Column(Integer, primary_key=True)
    email = Column(String(255), unique=True, nullable=False)
    hashed_password = Column(String(255), nullable=False)
    created_at = Column(DateTime, server_default=func.now())


# ============================================
# SETTINGS
# ============================================
class BusinessProfile(Base):
    __tablename__ = "business_profile"
    id = Column(Integer, primary_key=True)
    business_name = Column(String(100), nullable=False)
    business_email = Column(String(255), nullable=False)
    business_contact_number = Column(String(50), nullable=False)
    address = Column(Text)
    logo_url = Column(String(500))
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())


class ForecastConfig(Base):
    __tablename__ = "forecast_config"
    id = Column(Integer, primary_key=True)
    safety_buffer_percentage = Column(Numeric(5, 2), default=15.00)
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())


class SystemActionsLog(Base):
    __tablename__ = "system_actions_log"
    id = Column(Integer, primary_key=True)
    action_type = Column(String(50), nullable=False)
    performed_at = Column(DateTime, server_default=func.now())
    details = Column(Text)


# ============================================
# PRODUCTS & INGREDIENTS
# ============================================
class Product(Base):
    __tablename__ = "products"
    id = Column(Integer, primary_key=True)
    name = Column(String(100), unique=True, nullable=False)
    price = Column(Numeric(10, 2), nullable=False)
    category = Column(String(50), nullable=False)
    serving_size_label = Column(String(100))
    is_active = Column(Boolean, default=True)
    first_sold_date = Column(Date)
    created_at = Column(DateTime, server_default=func.now())

    daily_sales = relationship("DailySales", back_populates="product")
    ingredients = relationship("ProductIngredient", back_populates="product")


class Ingredient(Base):
    __tablename__ = "ingredients"
    id = Column(Integer, primary_key=True)
    name = Column(String(100), unique=True, nullable=False)
    unit = Column(String(50), nullable=False)


class ProductIngredient(Base):
    """A recipe mapping is meaningless without the product or ingredient it links —
    if either is deleted, this mapping row goes with it."""
    __tablename__ = "product_ingredients"
    id = Column(Integer, primary_key=True)
    product_id = Column(Integer, ForeignKey("products.id", ondelete="CASCADE"))
    ingredient_id = Column(Integer, ForeignKey("ingredients.id", ondelete="CASCADE"))
    quantity_per_serving = Column(Numeric(10, 3), nullable=False)

    product = relationship("Product", back_populates="ingredients")

    __table_args__ = (
        UniqueConstraint('product_id', 'ingredient_id', name='product_ingredients_product_id_ingredient_id_key'),
    )

# ============================================
# REFERENCE DATA — HOLIDAYS
# No Payday model — computed via app/utils/date_features.py::is_payday()
# ============================================
class FixedHoliday(Base):
    """Same month/day every year (e.g., Independence Day, Christmas). Never needs updating."""
    __tablename__ = "fixed_holidays"
    id = Column(Integer, primary_key=True)
    month = Column(Integer, nullable=False)
    day = Column(Integer, nullable=False)
    label = Column(String(255), nullable=False)


class SpecialHoliday(Base):
    """Movable/proclaimed holidays, year-specific. Requires periodic manual updates."""
    __tablename__ = "special_holidays"
    id = Column(Integer, primary_key=True)
    date = Column(Date, unique=True, nullable=False)
    label = Column(String(255), nullable=False)


# ============================================
# SALES DATA
# ============================================
class Upload(Base):
    __tablename__ = "uploads"
    id = Column(Integer, primary_key=True)
    filename = Column(String(255), nullable=False)
    upload_date = Column(DateTime, server_default=func.now())
    row_count = Column(Integer)
    status = Column(String(50), default="pending")
    error_message = Column(Text)


class DailySales(Base):
    """product_id: RESTRICT — a product can't be deleted while sales history
    (training data) still references it; forces a deliberate choice (e.g. mark
    inactive) instead of silently losing data.
    upload_id: SET NULL — deleting the upload record shouldn't delete the real
    sales rows it introduced."""
    __tablename__ = "daily_sales"
    id = Column(Integer, primary_key=True)
    product_id = Column(Integer, ForeignKey("products.id", ondelete="RESTRICT"))
    sale_date = Column(Date, nullable=False)
    quantity_sold = Column(Integer, nullable=False)
    upload_id = Column(Integer, ForeignKey("uploads.id", ondelete="SET NULL"))

    product = relationship("Product", back_populates="daily_sales")

    __table_args__ = (
        UniqueConstraint('product_id', 'sale_date', name='daily_sales_product_id_sale_date_key'),
    )
# ============================================
# ML OUTPUTS
# ============================================
class Forecast(Base):
    """product_id: CASCADE — forecasts are derived output, not source data."""
    __tablename__ = "forecasts"
    id = Column(Integer, primary_key=True)
    product_id = Column(Integer, ForeignKey("products.id", ondelete="CASCADE"))
    forecast_date = Column(Date, nullable=False)
    predicted_quantity = Column(Numeric(10, 2), nullable=False)
    predicted_revenue = Column(Numeric(10, 2))
    model_version = Column(String(50))
    created_at = Column(DateTime, server_default=func.now())


class ModelMetric(Base):
    __tablename__ = "model_metrics"
    id = Column(Integer, primary_key=True)
    model_version = Column(String(50), nullable=False)
    evaluation_date = Column(Date, server_default=func.now())
    mape = Column(Numeric(10, 4))
    mae = Column(Numeric(10, 4))
    rmse = Column(Numeric(10, 4))
    notes = Column(Text)


class ProductClassification(Base):
    __tablename__ = "product_classifications"
    id = Column(Integer, primary_key=True)
    product_id = Column(Integer, ForeignKey("products.id", ondelete="CASCADE"))
    classification_date = Column(Date, server_default=func.now())
    demand_tier = Column(String(50), nullable=False)
    basis = Column(String(255))