# app/models/database.py
from sqlalchemy import Column, Integer, String, Numeric, Date, DateTime, Boolean, ForeignKey, Text
from sqlalchemy.orm import declarative_base, relationship
from sqlalchemy.sql import func

Base = declarative_base()


class User(Base):
    """Single shared account representing ChefDuo's ownership. Expected to hold exactly one row."""
    __tablename__ = "users"
    id = Column(Integer, primary_key=True)
    email = Column(String(255), unique=True, nullable=False)
    hashed_password = Column(String(255), nullable=False)
    created_at = Column(DateTime, server_default=func.now())


class BusinessProfile(Base):
    """Business identity info for Settings > Business Profile. Single-row table."""
    __tablename__ = "business_profile"
    id = Column(Integer, primary_key=True)
    business_name = Column(String(255), nullable=False)
    address = Column(Text)
    logo_url = Column(String(500))
    owner_names = Column(String(255))
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())


class ForecastConfig(Base):
    """Owner-adjustable forecasting parameters. Single-row table."""
    __tablename__ = "forecast_config"
    id = Column(Integer, primary_key=True)
    # NOTE: pending team decision — confirm single combined buffer vs. two-part
    # formula against Chapter 2 before finalizing this column.
    safety_buffer_percentage = Column(Numeric(5, 2), default=15.00)
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())


class SystemActionsLog(Base):
    """Audit trail for destructive Data Management actions (backup, export, reset)."""
    __tablename__ = "system_actions_log"
    id = Column(Integer, primary_key=True)
    action_type = Column(String(50), nullable=False)  # 'backup', 'export', 'reset'
    performed_at = Column(DateTime, server_default=func.now())
    details = Column(Text)


class Product(Base):
    __tablename__ = "products"
    id = Column(Integer, primary_key=True)
    name = Column(String(255), unique=True, nullable=False)
    price = Column(Numeric(10, 2), nullable=False)
    is_active = Column(Boolean, default=True)
    first_sold_date = Column(Date)
    # NOTE: pending client confirmation — informational label vs. ingredient-math multiplier.
    # Using the informational version until confirmed:
    serving_size_label = Column(String(100))
    created_at = Column(DateTime, server_default=func.now())

    daily_sales = relationship("DailySales", back_populates="product")
    ingredients = relationship("ProductIngredient", back_populates="product")


class HolidayPayday(Base):
    """Preloaded internal reference data — NOT owner-uploaded. Seeded via script."""
    __tablename__ = "holidays_paydays"
    id = Column(Integer, primary_key=True)
    date = Column(Date, unique=True, nullable=False)
    type = Column(String(50), nullable=False)  # 'holiday' or 'payday'
    label = Column(String(255))


class Upload(Base):
    __tablename__ = "uploads"
    id = Column(Integer, primary_key=True)
    filename = Column(String(255), nullable=False)
    upload_date = Column(DateTime, server_default=func.now())
    row_count = Column(Integer)
    status = Column(String(50), default="pending")
    error_message = Column(Text)


class DailySales(Base):
    __tablename__ = "daily_sales"
    id = Column(Integer, primary_key=True)
    product_id = Column(Integer, ForeignKey("products.id"))
    sale_date = Column(Date, nullable=False)
    quantity_sold = Column(Integer, nullable=False)
    upload_id = Column(Integer, ForeignKey("uploads.id"))

    product = relationship("Product", back_populates="daily_sales")

    __table_args__ = ({"sqlite_autoincrement": True},)


class Ingredient(Base):
    __tablename__ = "ingredients"
    id = Column(Integer, primary_key=True)
    name = Column(String(255), unique=True, nullable=False)
    unit = Column(String(50), nullable=False)


class ProductIngredient(Base):
    __tablename__ = "product_ingredients"
    id = Column(Integer, primary_key=True)
    product_id = Column(Integer, ForeignKey("products.id"))
    ingredient_id = Column(Integer, ForeignKey("ingredients.id"))
    quantity_per_serving = Column(Numeric(10, 3), nullable=False)

    product = relationship("Product", back_populates="ingredients")


class Forecast(Base):
    __tablename__ = "forecasts"
    id = Column(Integer, primary_key=True)
    product_id = Column(Integer, ForeignKey("products.id"))
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
    product_id = Column(Integer, ForeignKey("products.id"))
    classification_date = Column(Date, server_default=func.now())
    demand_tier = Column(String(50), nullable=False)
    basis = Column(String(255))