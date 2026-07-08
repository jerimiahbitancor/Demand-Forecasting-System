"""restore unique constraints on daily_sales and product_ingredients

Revision ID: 71edf9fdc6f5
Revises: 5e3d2b4e6efc
Create Date: 2026-07-08 18:47:17.692589

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '71edf9fdc6f5'
down_revision: Union[str, Sequence[str], None] = '5e3d2b4e6efc'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.create_unique_constraint(
        'daily_sales_product_id_sale_date_key',
        'daily_sales',
        ['product_id', 'sale_date']
    )
    op.create_unique_constraint(
        'product_ingredients_product_id_ingredient_id_key',
        'product_ingredients',
        ['product_id', 'ingredient_id']
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_constraint(
        'product_ingredients_product_id_ingredient_id_key',
        'product_ingredients',
        type_='unique'
    )
    op.drop_constraint(
        'daily_sales_product_id_sale_date_key',
        'daily_sales',
        type_='unique'
    )