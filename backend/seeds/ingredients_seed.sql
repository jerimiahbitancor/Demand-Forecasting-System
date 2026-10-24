-- ---------------------------------------------------------------------------
-- ingredients_seed.sql -- researched ingredient costs for the inventory.
--
-- WHAT THIS DOES
--   One idempotent upsert of every ingredient with:
--     * a researched Philippine market price (Sep-Oct 2026) per STOCK UNIT,
--     * the canonical unit columns the app writes (base_unit, unit_family,
--       allow_fractional),
--     * the missing category_id / unit_id links for the newer rows.
--
--   ingredients.price is stored directly in the selected stock unit.
--
--   quantity, min_stock and is_archived are NOT touched by the UPDATE.
--   Your stock on hand and your reorder points stay exactly as they are.
--
--   Re-runnable: it upserts on id, so running it twice is harmless.
--
-- HOW TO RUN
--   Supabase -> SQL Editor -> paste this file -> Run. Or:
--   psql "$DATABASE_URL" -f backend/seeds/ingredients_seed.sql
--
-- SOURCES USED FOR THE PRICES
--   PSA price situationers (2026): rice ₱49.61/kg, dressed chicken ₱213.43/kg,
--     pork liempo ₱368.83/kg, pork meat w/ bones ₱301.06/kg, bangus ₱249.61/kg,
--     carrot ₱167.58/kg, red onion ₱153.59/kg, ginger ₱164.07/kg,
--     brown sugar ₱72.22/kg, egg ₱9.17-9.24/pc, cooking oil ₱200.04/L.
--   DA price monitoring (2026): garlic ₱155.36/kg, banana latundan ₱76.61/kg,
--     sweet corn ₱52.96-76.61/kg, refined sugar ₱83.35/kg, washed ₱74.03/kg.
--   DA BFAR Retail Price Monitoring (May 2026): whiteleg shrimp ₱480-500/kg.
--   SM Markets / SM Food Service (2026): Magnolia cream cheese 1 kg ₱624,
--     Magnolia Gold unsalted butter 225 g ₱179, Magnolia Quickmelt 440 g
--     ₱232.50, Chiz Boy mozzarella 350 g ₱156, Eden filled cheese 430 g ₱146.50.
--   Coffee roaster wholesale lists (2026): beans ₱773-1,015/kg per 10 kg box.
--   Sugar mill / wholesale lists (2026): refined ₱56-70/kg, brown ₱48-58/kg.
--   Flour 25 kg sack ₱1,220-1,590; condensed milk 397 g can ≈ ₱45.
--
-- NOTE ON THE HERBS AND SPICES
--   Basil, Bay Leaves, Cinnamon, Cilantro, Cumin, Oregano, Paprika, Parsley,
--   Thyme and Turmeric are stocked in GRAMS, so their price is now per gram
--   (₱0.25/g instead of the old ₱250 that was really a per-kilo number).
--   Before this their cost was counted 1000x too high.
-- ---------------------------------------------------------------------------

BEGIN;

INSERT INTO public.ingredients (
  id, name, category, material_type, category_id, unit, unit_id,
  price, base_unit, unit_family, stock_scale, allow_fractional,
  quantity, min_stock, is_archived
) VALUES
-- Boneless chicken breast, ₱230-280/kg
  (54, 'Chicken Breast', 'Meat & Poultry', 'wet', '15bac7ce-21cb-4ddd-ba44-a08e249c299d', 'Kilograms (kg)', '0a1080a8-68fb-4da8-813d-b8f0c49e378d', 260, 'kg', 'mass', 3, true, 25, 5, true),
-- Chicken thigh (bone-in), dressed chicken ₱213.43/kg (PSA Jun 2026) + ₱15
  (55, 'Chicken Thigh', 'Meat & Poultry', 'wet', '15bac7ce-21cb-4ddd-ba44-a08e249c299d', 'Kilograms (kg)', '0a1080a8-68fb-4da8-813d-b8f0c49e378d', 230, 'kg', 'mass', 3, true, 0, 5, false),
-- Dressed chicken, ₱213.43/kg (PSA Jun 2026)
  (56, 'Whole Chicken', 'Meat & Poultry', 'wet', '15bac7ce-21cb-4ddd-ba44-a08e249c299d', 'Kilograms (kg)', '0a1080a8-68fb-4da8-813d-b8f0c49e378d', 215, 'kg', 'mass', 3, true, 0, 5, false),
-- Pork belly (liempo), ₱368.83/kg (PSA Apr 2026), NCR ~₱420
  (57, 'Pork Belly', 'Meat & Poultry', 'wet', '15bac7ce-21cb-4ddd-ba44-a08e249c299d', 'Kilograms (kg)', '0a1080a8-68fb-4da8-813d-b8f0c49e378d', 380, 'kg', 'mass', 3, true, 20, 5, false),
-- Pork shoulder (kasim), ₱314.50/kg (PSA Batangas Feb 2026)
  (58, 'Pork Shoulder', 'Meat & Poultry', 'wet', '15bac7ce-21cb-4ddd-ba44-a08e249c299d', 'Kilograms (kg)', '0a1080a8-68fb-4da8-813d-b8f0c49e378d', 330, 'kg', 'mass', 3, true, 15, 5, false),
-- Ground pork, fresh pork kasim ₱314.50/kg (PSA Batangas Feb 2026)
  (59, 'Ground Pork', 'Meat & Poultry', 'wet', '15bac7ce-21cb-4ddd-ba44-a08e249c299d', 'Kilograms (kg)', '0a1080a8-68fb-4da8-813d-b8f0c49e378d', 340, 'kg', 'mass', 3, true, 0, 3, false),
-- Beef pure meat, ₱435/kg (DA Aug 2026)
  (60, 'Beef', 'Meat & Poultry', 'wet', '15bac7ce-21cb-4ddd-ba44-a08e249c299d', 'Kilograms (kg)', '0a1080a8-68fb-4da8-813d-b8f0c49e378d', 430, 'kg', 'mass', 3, true, 0, 3, false),
-- Ground beef, ₱400-450/kg
  (61, 'Ground Beef', 'Meat & Poultry', 'wet', '15bac7ce-21cb-4ddd-ba44-a08e249c299d', 'Kilograms (kg)', '0a1080a8-68fb-4da8-813d-b8f0c49e378d', 430, 'kg', 'mass', 3, true, 8.36, 3, false),
-- Beef short rib, ₱450-520/kg
  (62, 'Beef Short Ribs', 'Meat & Poultry', 'wet', '15bac7ce-21cb-4ddd-ba44-a08e249c299d', 'Kilograms (kg)', '0a1080a8-68fb-4da8-813d-b8f0c49e378d', 480, 'kg', 'mass', 3, true, 8, 2, false),
-- Chicken liver, ₱180-200/kg
  (63, 'Chicken Liver', 'Meat & Poultry', 'wet', '15bac7ce-21cb-4ddd-ba44-a08e249c299d', 'Kilograms (kg)', '0a1080a8-68fb-4da8-813d-b8f0c49e378d', 190, 'kg', 'mass', 3, true, 5, 1, false),
-- Bangus, ₱249.61/kg (PSA Apr 2026)
  (64, 'Bangus', 'Seafood', 'wet', '78d959b5-6b3a-4a9f-9f35-d9298171d737', 'Kilograms (kg)', '0a1080a8-68fb-4da8-813d-b8f0c49e378d', 250, 'kg', 'mass', 3, true, 10, 3, false),
-- Tilapia, ₱190.12/kg (PSA Feb 2026)
  (65, 'Tilapia', 'Seafood', 'wet', '78d959b5-6b3a-4a9f-9f35-d9298171d737', 'Kilograms (kg)', '0a1080a8-68fb-4da8-813d-b8f0c49e378d', 190, 'kg', 'mass', 3, true, 10, 3, false),
-- Salmon (imported), ₱650-750/kg
  (66, 'Salmon', 'Seafood', 'wet', '78d959b5-6b3a-4a9f-9f35-d9298171d737', 'Kilograms (kg)', '0a1080a8-68fb-4da8-813d-b8f0c49e378d', 700, 'kg', 'mass', 3, true, 5, 1, false),
-- Whiteleg shrimp, ₱480-500/kg (DA BFAR May 2026)
  (67, 'Shrimp', 'Seafood', 'wet', '78d959b5-6b3a-4a9f-9f35-d9298171d737', 'Kilograms (kg)', '0a1080a8-68fb-4da8-813d-b8f0c49e378d', 520, 'kg', 'mass', 3, true, 8, 2, false),
-- Squid, ₱350-400/kg
  (68, 'Squid', 'Seafood', 'wet', '78d959b5-6b3a-4a9f-9f35-d9298171d737', 'Kilograms (kg)', '0a1080a8-68fb-4da8-813d-b8f0c49e378d', 380, 'kg', 'mass', 3, true, 8, 2, false),
-- Tuna, ₱400-450/kg
  (69, 'Tuna', 'Seafood', 'wet', '78d959b5-6b3a-4a9f-9f35-d9298171d737', 'Kilograms (kg)', '0a1080a8-68fb-4da8-813d-b8f0c49e378d', 420, 'kg', 'mass', 3, true, 5, 1, false),
-- Mussels (tahong), ₱180-220/kg
  (70, 'Mussels', 'Seafood', 'wet', '78d959b5-6b3a-4a9f-9f35-d9298171d737', 'Kilograms (kg)', '0a1080a8-68fb-4da8-813d-b8f0c49e378d', 200, 'kg', 'mass', 3, true, 5, 1, false),
-- Crab, ₱450-550/kg
  (71, 'Crab', 'Seafood', 'wet', '78d959b5-6b3a-4a9f-9f35-d9298171d737', 'Kilograms (kg)', '0a1080a8-68fb-4da8-813d-b8f0c49e378d', 500, 'kg', 'mass', 3, true, 5, 1, false),
-- Garlic, ₱155.36/kg imported (DA Bicol Jun 2026)
  (72, 'Garlic', 'Vegetables & Fruits', 'wet', 'f6bfd377-0c12-4ad5-b9e8-21c7b71df6d5', 'Kilograms (kg)', '0a1080a8-68fb-4da8-813d-b8f0c49e378d', 170, 'kg', 'mass', 3, true, 7.868, 2, false),
-- Onion (red), ₱153.59/kg (PSA Apr 2026)
  (73, 'Onion', 'Vegetables & Fruits', 'wet', 'f6bfd377-0c12-4ad5-b9e8-21c7b71df6d5', 'Kilograms (kg)', '0a1080a8-68fb-4da8-813d-b8f0c49e378d', 130, 'kg', 'mass', 3, true, 10, 3, false),
-- Red onion, ₱153.59/kg (PSA Apr 2026)
  (74, 'Red Onion', 'Vegetables & Fruits', 'wet', 'f6bfd377-0c12-4ad5-b9e8-21c7b71df6d5', 'Kilograms (kg)', '0a1080a8-68fb-4da8-813d-b8f0c49e378d', 150, 'kg', 'mass', 3, true, 1.85, 2, false),
-- Ginger (hawaiian), ₱164.07/kg (PSA Aug 2026)
  (75, 'Ginger', 'Vegetables & Fruits', 'wet', 'f6bfd377-0c12-4ad5-b9e8-21c7b71df6d5', 'Kilograms (kg)', '0a1080a8-68fb-4da8-813d-b8f0c49e378d', 164, 'kg', 'mass', 3, true, 5, 1, false),
-- Potato, ₱140/kg (DA Aug 2026)
  (76, 'Potato', 'Vegetables & Fruits', 'wet', 'f6bfd377-0c12-4ad5-b9e8-21c7b71df6d5', 'Kilograms (kg)', '0a1080a8-68fb-4da8-813d-b8f0c49e378d', 140, 'kg', 'mass', 3, true, 15, 3, false),
-- Carrot, ₱167.58/kg (PSA Apr 2026)
  (77, 'Carrots', 'Vegetables & Fruits', 'wet', 'f6bfd377-0c12-4ad5-b9e8-21c7b71df6d5', 'Kilograms (kg)', '0a1080a8-68fb-4da8-813d-b8f0c49e378d', 168, 'kg', 'mass', 3, true, 8, 2, false),
-- Cabbage, ₱105/kg (DA Aug 2026)
  (78, 'Cabbage', 'Vegetables & Fruits', 'wet', 'f6bfd377-0c12-4ad5-b9e8-21c7b71df6d5', 'Kilograms (kg)', '0a1080a8-68fb-4da8-813d-b8f0c49e378d', 105, 'kg', 'mass', 3, true, 10, 3, false),
-- Pechay, ₱40-80/kg
  (79, 'Pechay', 'Vegetables & Fruits', 'wet', 'f6bfd377-0c12-4ad5-b9e8-21c7b71df6d5', 'Kilograms (kg)', '0a1080a8-68fb-4da8-813d-b8f0c49e378d', 60, 'kg', 'mass', 3, true, 8, 2, false),
-- Spinach, ₱80-120/kg
  (80, 'Spinach', 'Vegetables & Fruits', 'wet', 'f6bfd377-0c12-4ad5-b9e8-21c7b71df6d5', 'Kilograms (kg)', '0a1080a8-68fb-4da8-813d-b8f0c49e378d', 100, 'kg', 'mass', 3, true, 5, 1, false),
-- Lettuce, ₱80-130/kg
  (81, 'Lettuce', 'Vegetables & Fruits', 'wet', 'f6bfd377-0c12-4ad5-b9e8-21c7b71df6d5', 'Kilograms (kg)', '0a1080a8-68fb-4da8-813d-b8f0c49e378d', 110, 'kg', 'mass', 3, true, 5, 1, false),
-- Tomato, ₱107.50/kg (PSA Batangas Feb 2026)
  (82, 'Tomato', 'Vegetables & Fruits', 'wet', 'f6bfd377-0c12-4ad5-b9e8-21c7b71df6d5', 'Kilograms (kg)', '0a1080a8-68fb-4da8-813d-b8f0c49e378d', 107, 'kg', 'mass', 3, true, 8, 2, false),
-- Bell pepper, ₱120-180/kg
  (83, 'Bell Pepper', 'Vegetables & Fruits', 'wet', 'f6bfd377-0c12-4ad5-b9e8-21c7b71df6d5', 'Kilograms (kg)', '0a1080a8-68fb-4da8-813d-b8f0c49e378d', 150, 'kg', 'mass', 3, true, 5, 1, false),
-- Chili pepper (siling), ₱100-140/kg
  (84, 'Chili Pepper', 'Vegetables & Fruits', 'wet', 'f6bfd377-0c12-4ad5-b9e8-21c7b71df6d5', 'Kilograms (kg)', '0a1080a8-68fb-4da8-813d-b8f0c49e378d', 120, 'kg', 'mass', 3, true, 8.958, 1, false),
-- Spring onion, ₱100-150/kg
  (85, 'Spring Onion', 'Vegetables & Fruits', 'wet', 'f6bfd377-0c12-4ad5-b9e8-21c7b71df6d5', 'Kilograms (kg)', '0a1080a8-68fb-4da8-813d-b8f0c49e378d', 120, 'kg', 'mass', 3, true, 4, 1, false),
-- Cucumber, ₱70-90/kg
  (86, 'Cucumber', 'Vegetables & Fruits', 'wet', 'f6bfd377-0c12-4ad5-b9e8-21c7b71df6d5', 'Kilograms (kg)', '0a1080a8-68fb-4da8-813d-b8f0c49e378d', 80, 'kg', 'mass', 3, true, 5, 1, false),
-- Button mushrooms, ₱200-300/kg
  (87, 'Mushroom', 'Vegetables & Fruits', 'wet', 'f6bfd377-0c12-4ad5-b9e8-21c7b71df6d5', 'Kilograms (kg)', '0a1080a8-68fb-4da8-813d-b8f0c49e378d', 250, 'kg', 'mass', 3, true, 5, 1, false),
-- Sweet corn, ₱52.96-76.61/kg (DA Bicol Jun 2026)
  (88, 'Corn', 'Vegetables & Fruits', 'wet', 'f6bfd377-0c12-4ad5-b9e8-21c7b71df6d5', 'Kilograms (kg)', '0a1080a8-68fb-4da8-813d-b8f0c49e378d', 60, 'kg', 'mass', 3, true, 5, 1, false),
-- Lemon, ₱120-180/kg
  (89, 'Lemon', 'Vegetables & Fruits', 'wet', 'f6bfd377-0c12-4ad5-b9e8-21c7b71df6d5', 'Kilograms (kg)', '0a1080a8-68fb-4da8-813d-b8f0c49e378d', 140, 'kg', 'mass', 3, true, 5, 1, false),
-- Calamansi, ₱110/kg (DA Aug 2026)
  (90, 'Calamansi', 'Vegetables & Fruits', 'wet', 'f6bfd377-0c12-4ad5-b9e8-21c7b71df6d5', 'Kilograms (kg)', '0a1080a8-68fb-4da8-813d-b8f0c49e378d', 110, 'kg', 'mass', 3, true, 10, 1, false),
-- Banana (latundan), ₱76.61/kg (DA Bicol Jun 2026)
  (91, 'Banana', 'Vegetables & Fruits', 'wet', 'f6bfd377-0c12-4ad5-b9e8-21c7b71df6d5', 'Kilograms (kg)', '0a1080a8-68fb-4da8-813d-b8f0c49e378d', 77, 'kg', 'mass', 3, true, 5, 1, false),
-- Regular milled rice ₱49.61/kg (PSA Aug 2026); 50 kg sack ₱2,500
  (92, 'Rice', 'Grains, Noodles & Starches', 'dry', '1fb52812-db0e-4591-9aa9-964f8c031e69', 'Kilograms (kg)', '0a1080a8-68fb-4da8-813d-b8f0c49e378d', 50, 'kg', 'mass', 3, true, 7.2, 10, false),
-- Rice noodles, ₱100-130/kg
  (95, 'Rice Noodles', 'Grains, Noodles & Starches', 'dry', '1fb52812-db0e-4591-9aa9-964f8c031e69', 'Kilograms (kg)', '0a1080a8-68fb-4da8-813d-b8f0c49e378d', 110, 'kg', 'mass', 3, true, 10, 2, false),
-- Glass noodles, ₱70-100/kg
  (96, 'Glass Noodles', 'Grains, Noodles & Starches', 'dry', '1fb52812-db0e-4591-9aa9-964f8c031e69', 'Kilograms (kg)', '0a1080a8-68fb-4da8-813d-b8f0c49e378d', 90, 'kg', 'mass', 3, true, 5, 1, false),
-- Wheat noodles, ₱100-130/kg
  (97, 'Wheat Noodles', 'Grains, Noodles & Starches', 'dry', '1fb52812-db0e-4591-9aa9-964f8c031e69', 'Kilograms (kg)', '0a1080a8-68fb-4da8-813d-b8f0c49e378d', 110, 'kg', 'mass', 3, true, 10, 2, false),
-- Udon noodles, ₱120-150/kg
  (98, 'Udon Noodles', 'Grains, Noodles & Starches', 'dry', '1fb52812-db0e-4591-9aa9-964f8c031e69', 'Kilograms (kg)', '0a1080a8-68fb-4da8-813d-b8f0c49e378d', 130, 'kg', 'mass', 3, true, 5, 1, false),
-- Cornstarch, ₱45-60/kg
  (99, 'Cornstarch', 'Grains, Noodles & Starches', 'dry', '1fb52812-db0e-4591-9aa9-964f8c031e69', 'Kilograms (kg)', '0a1080a8-68fb-4da8-813d-b8f0c49e378d', 55, 'kg', 'mass', 3, true, 5, 1, false),
-- 25 kg sack ₱1,220-1,590 -> ₱58/kg (Shopee/PSA cereal wholesale)
  (100, 'All-Purpose Flour', 'Grains, Noodles & Starches', 'dry', '1fb52812-db0e-4591-9aa9-964f8c031e69', 'Kilograms (kg)', '0a1080a8-68fb-4da8-813d-b8f0c49e378d', 58, 'kg', 'mass', 3, true, 10, 3, true),
-- Potato starch, ₱50-70/kg
  (101, 'Potato Starch', 'Grains, Noodles & Starches', 'dry', '1fb52812-db0e-4591-9aa9-964f8c031e69', 'Kilograms (kg)', '0a1080a8-68fb-4da8-813d-b8f0c49e378d', 60, 'kg', 'mass', 3, true, 5, 1, false),
-- Fresh milk, ₱95-110/L
  (102, 'Milk', 'Dairy & Milk Products', 'wet', 'c19f07be-18c9-422c-9127-84f1a975e44a', 'Liters (L)', '5a896d4b-9d4f-4d1e-b40a-529055896ede', 100, 'l', 'volume', 3, true, 10, 3, false),
-- All-purpose fresh cream, ₱180-250/L
  (103, 'Fresh Cream', 'Dairy & Milk Products', 'wet', 'c19f07be-18c9-422c-9127-84f1a975e44a', 'Liters (L)', '5a896d4b-9d4f-4d1e-b40a-529055896ede', 220, 'l', 'volume', 3, true, 5, 1, false),
-- Unsalted baking butter, ₱796/kg (Magnolia Gold 225 g ₱179) - ₱995/kg (Anchor 200 g ₱199)
  (104, 'Butter', 'Dairy & Milk Products', 'wet', 'c19f07be-18c9-422c-9127-84f1a975e44a', 'Kilograms (kg)', '0a1080a8-68fb-4da8-813d-b8f0c49e378d', 850.220264, 'kg', 'mass', 3, true, 0, 1, false),
-- Local filled cheese, ₱341/kg (Eden 430 g ₱146.50)
  (105, 'Cheese', 'Dairy & Milk Products', 'wet', 'c19f07be-18c9-422c-9127-84f1a975e44a', 'Kilograms (kg)', '0a1080a8-68fb-4da8-813d-b8f0c49e378d', 350, 'kg', 'mass', 3, true, 1.319, 1, false),
-- Mozzarella/quickmelt, ₱528/kg (Magnolia Quickmelt 440 g ₱232.50)
  (106, 'Mozzarella Cheese', 'Dairy & Milk Products', 'wet', 'c19f07be-18c9-422c-9127-84f1a975e44a', 'Kilograms (kg)', '0a1080a8-68fb-4da8-813d-b8f0c49e378d', 520, 'kg', 'mass', 3, true, 5, 1, false),
-- Magnolia cream cheese 1 kg ₱624 (SM Food Service)
  (107, 'Cream Cheese', 'Dairy & Milk Products', 'wet', 'c19f07be-18c9-422c-9127-84f1a975e44a', 'Kilograms (kg)', '0a1080a8-68fb-4da8-813d-b8f0c49e378d', 624, 'kg', 'mass', 3, true, 9, 1, false),
-- Plain yogurt, ₱130-180/kg
  (108, 'Yogurt', 'Dairy & Milk Products', 'wet', 'c19f07be-18c9-422c-9127-84f1a975e44a', 'Liters (L)', '5a896d4b-9d4f-4d1e-b40a-529055896ede', 160, 'l', 'volume', 3, true, 5, 1, false),
-- Soy sauce, ₱75-128/L (1.8 L bottle ≈ ₱180-230)
  (109, 'Soy Sauce', 'Condiments, Sauces & Seasonings', 'wet', '01d8dc51-05d1-4404-beb0-71c9e60110a4', 'Liters (L)', '5a896d4b-9d4f-4d1e-b40a-529055896ede', 85, 'l', 'volume', 3, true, 0, 2, false),
-- Vinegar, ₱55-80/L
  (110, 'Vinegar', 'Condiments, Sauces & Seasonings', 'wet', '01d8dc51-05d1-4404-beb0-71c9e60110a4', 'Liters (L)', '5a896d4b-9d4f-4d1e-b40a-529055896ede', 65, 'l', 'volume', 3, true, 6, 2, false),
-- Oyster sauce, ₱110-150/L
  (111, 'Oyster Sauce', 'Condiments, Sauces & Seasonings', 'wet', '01d8dc51-05d1-4404-beb0-71c9e60110a4', 'Liters (L)', '5a896d4b-9d4f-4d1e-b40a-529055896ede', 130, 'l', 'volume', 3, true, 5, 1, false),
-- Fish sauce, ₱70-90/L (1.8 L bottle ≈ ₱135)
  (112, 'Fish Sauce', 'Condiments, Sauces & Seasonings', 'wet', '01d8dc51-05d1-4404-beb0-71c9e60110a4', 'Liters (L)', '5a896d4b-9d4f-4d1e-b40a-529055896ede', 75, 'l', 'volume', 3, true, 5, 1, false),
-- Tomato sauce (catsup), ₱80-110/L
  (113, 'Tomato Sauce', 'Condiments, Sauces & Seasonings', 'wet', '01d8dc51-05d1-4404-beb0-71c9e60110a4', 'Liters (L)', '5a896d4b-9d4f-4d1e-b40a-529055896ede', 90, 'l', 'volume', 3, true, 6, 2, false),
-- Ketchup, ₱100-140/L
  (114, 'Ketchup', 'Condiments, Sauces & Seasonings', 'wet', '01d8dc51-05d1-4404-beb0-71c9e60110a4', 'Liters (L)', '5a896d4b-9d4f-4d1e-b40a-529055896ede', 120, 'l', 'volume', 3, true, 5, 1, false),
-- Mayonnaise, ₱140-180/kg
  (115, 'Mayonnaise', 'Condiments, Sauces & Seasonings', 'dry', '01d8dc51-05d1-4404-beb0-71c9e60110a4', 'Kilograms (kg)', '0a1080a8-68fb-4da8-813d-b8f0c49e378d', 160, 'kg', 'mass', 3, true, 0, 1, false),
-- Chili sauce, ₱100-150/L
  (116, 'Chili Sauce', 'Condiments, Sauces & Seasonings', 'wet', '01d8dc51-05d1-4404-beb0-71c9e60110a4', 'Liters (L)', '5a896d4b-9d4f-4d1e-b40a-529055896ede', 120, 'l', 'volume', 3, true, 7.63, 1, false),
-- Sesame oil, ₱180-250/L
  (117, 'Sesame Oil', 'Condiments, Sauces & Seasonings', 'wet', '01d8dc51-05d1-4404-beb0-71c9e60110a4', 'Liters (L)', '5a896d4b-9d4f-4d1e-b40a-529055896ede', 220, 'l', 'volume', 3, true, 3, 1, false),
-- Cooking oil, retail ₱200.04/L (PSA Aug 2026); 1.8 L bottle ≈ ₱234 -> ₱130/L
  (118, 'Cooking Oil', 'Condiments, Sauces & Seasonings', 'wet', '01d8dc51-05d1-4404-beb0-71c9e60110a4', 'Liters (L)', '5a896d4b-9d4f-4d1e-b40a-529055896ede', 130, 'l', 'volume', 3, true, 20, 5, false),
-- Food-grade salt, ₱20-30/kg
  (119, 'Salt', 'Condiments, Sauces & Seasonings', 'dry', '01d8dc51-05d1-4404-beb0-71c9e60110a4', 'Kilograms (kg)', '0a1080a8-68fb-4da8-813d-b8f0c49e378d', 25, 'kg', 'mass', 3, true, 10, 3, false),
-- Refined sugar ₱83.35/kg (DA Bicol Jun 2026); wholesale ₱56-70/kg
  (120, 'White Sugar', 'Condiments, Sauces & Seasonings', 'dry', '01d8dc51-05d1-4404-beb0-71c9e60110a4', 'Kilograms (kg)', '0a1080a8-68fb-4da8-813d-b8f0c49e378d', 65, 'kg', 'mass', 3, true, 10, 3, false),
-- Brown sugar ₱67.96-72.22/kg (DA Jun 2026, PSA May 2026)
  (121, 'Brown Sugar', 'Condiments, Sauces & Seasonings', 'dry', '01d8dc51-05d1-4404-beb0-71c9e60110a4', 'Kilograms (kg)', '0a1080a8-68fb-4da8-813d-b8f0c49e378d', 70, 'kg', 'mass', 3, true, 4.67, 1, false),
-- Black peppercorn, ₱350-500/kg
  (122, 'Black Pepper', 'Condiments, Sauces & Seasonings', 'dry', '01d8dc51-05d1-4404-beb0-71c9e60110a4', 'Kilograms (kg)', '0a1080a8-68fb-4da8-813d-b8f0c49e378d', 400, 'kg', 'mass', 3, true, 2.984, 1, false),
-- MSG, ₱85-110/kg
  (123, 'MSG', 'Condiments, Sauces & Seasonings', 'dry', '01d8dc51-05d1-4404-beb0-71c9e60110a4', 'Kilograms (kg)', '0a1080a8-68fb-4da8-813d-b8f0c49e378d', 95, 'kg', 'mass', 3, true, 3, 1, false),
-- Basil ₱250/kg -> ₱0.25/g
  (124, 'Basil', 'Herbs & Spices', 'dry', '11615157-b170-446d-8edd-ac845693e59d', 'Grams (g)', 'deebea71-107a-4619-8a3f-65f103b8ee08', 0.25, 'g', 'mass', 3, true, 2000, 500, false),
-- Cilantro ₱180/kg -> ₱0.18/g
  (125, 'Cilantro', 'Herbs & Spices', 'dry', '11615157-b170-446d-8edd-ac845693e59d', 'Grams (g)', 'deebea71-107a-4619-8a3f-65f103b8ee08', 0.18, 'g', 'mass', 3, true, 2000, 500, false),
-- Parsley ₱250/kg -> ₱0.25/g
  (126, 'Parsley', 'Herbs & Spices', 'dry', '11615157-b170-446d-8edd-ac845693e59d', 'Grams (g)', 'deebea71-107a-4619-8a3f-65f103b8ee08', 0.25, 'g', 'mass', 3, true, 2000, 500, false),
-- Oregano ₱400/kg -> ₱0.40/g
  (127, 'Oregano', 'Herbs & Spices', 'dry', '11615157-b170-446d-8edd-ac845693e59d', 'Grams (g)', 'deebea71-107a-4619-8a3f-65f103b8ee08', 0.4, 'g', 'mass', 3, true, 2000, 500, false),
-- Thyme ₱400/kg -> ₱0.40/g
  (128, 'Thyme', 'Herbs & Spices', 'dry', '11615157-b170-446d-8edd-ac845693e59d', 'Grams (g)', 'deebea71-107a-4619-8a3f-65f103b8ee08', 0.4, 'g', 'mass', 3, true, 2000, 500, false),
-- Bay leaves ₱300/kg -> ₱0.30/g
  (129, 'Bay Leaves', 'Herbs & Spices', 'dry', '11615157-b170-446d-8edd-ac845693e59d', 'Grams (g)', 'deebea71-107a-4619-8a3f-65f103b8ee08', 0.3, 'g', 'mass', 3, true, 1994.6, 500, false),
-- Paprika ₱350/kg -> ₱0.35/g
  (130, 'Paprika', 'Herbs & Spices', 'dry', '11615157-b170-446d-8edd-ac845693e59d', 'Grams (g)', 'deebea71-107a-4619-8a3f-65f103b8ee08', 0.35, 'g', 'mass', 3, true, 2000, 500, false),
-- Cumin ₱400/kg -> ₱0.40/g
  (131, 'Cumin', 'Herbs & Spices', 'dry', '11615157-b170-446d-8edd-ac845693e59d', 'Grams (g)', 'deebea71-107a-4619-8a3f-65f103b8ee08', 0.4, 'g', 'mass', 3, true, 2000, 500, false),
-- Turmeric ₱300/kg -> ₱0.30/g
  (132, 'Turmeric', 'Herbs & Spices', 'dry', '11615157-b170-446d-8edd-ac845693e59d', 'Grams (g)', 'deebea71-107a-4619-8a3f-65f103b8ee08', 0.3, 'g', 'mass', 3, true, 2000, 500, false),
-- Cinnamon ₱350/kg -> ₱0.35/g
  (133, 'Cinnamon', 'Herbs & Spices', 'dry', '11615157-b170-446d-8edd-ac845693e59d', 'Grams (g)', 'deebea71-107a-4619-8a3f-65f103b8ee08', 0.35, 'g', 'mass', 3, true, 2000, 500, false),
-- Roasted coffee beans, wholesale ₱773-1,015/kg (10 kg box, Caffeine Brothers / Agross)
  (134, 'Coffee Beans', 'Beverages, Drinks & Syrups', 'dry', '0c27fd72-6085-4576-a2fa-e8ee2106903a', 'Kilograms (kg)', '0a1080a8-68fb-4da8-813d-b8f0c49e378d', 850, 'kg', 'mass', 3, true, 5, 1, false),
-- Ground coffee, ₱800/kg wholesale
  (135, 'Ground Coffee', 'Beverages, Drinks & Syrups', 'dry', '0c27fd72-6085-4576-a2fa-e8ee2106903a', 'Kilograms (kg)', '0a1080a8-68fb-4da8-813d-b8f0c49e378d', 800, 'kg', 'mass', 3, true, 5, 1, false),
-- Green tea ₱300/kg -> ₱0.30/g
  (136, 'Green Tea', 'Beverages, Drinks & Syrups', 'dry', '0c27fd72-6085-4576-a2fa-e8ee2106903a', 'Grams (g)', 'deebea71-107a-4619-8a3f-65f103b8ee08', 0.3, 'g', 'mass', 3, true, 3000, 500, false),
-- Black tea ₱250/kg -> ₱0.25/g
  (137, 'Black Tea', 'Beverages, Drinks & Syrups', 'dry', '0c27fd72-6085-4576-a2fa-e8ee2106903a', 'Grams (g)', 'deebea71-107a-4619-8a3f-65f103b8ee08', 0.25, 'g', 'mass', 3, true, 3000, 500, false),
-- Chocolate Syrup
  (138, 'Chocolate Syrup', 'Beverages, Drinks & Syrups', 'wet', '0c27fd72-6085-4576-a2fa-e8ee2106903a', 'Liters (L)', '5a896d4b-9d4f-4d1e-b40a-529055896ede', 250, 'l', 'volume', 3, true, 3, 1, false),
-- Caramel syrup, ₱200-250/L
  (139, 'Caramel Syrup', 'Beverages, Drinks & Syrups', 'wet', '0c27fd72-6085-4576-a2fa-e8ee2106903a', 'Liters (L)', '5a896d4b-9d4f-4d1e-b40a-529055896ede', 220, 'l', 'volume', 3, true, 3, 1, false),
-- Strawberry syrup, ₱180-220/L
  (140, 'Strawberry Syrup', 'Beverages, Drinks & Syrups', 'wet', '0c27fd72-6085-4576-a2fa-e8ee2106903a', 'Liters (L)', '5a896d4b-9d4f-4d1e-b40a-529055896ede', 200, 'l', 'volume', 3, true, 3, 1, false),
-- Condensed milk, 397 g can ≈ ₱45 -> 6 cans (2.382 L) ₱270
  (141, 'Condensed Milk', 'Beverages, Drinks & Syrups', 'wet', '0c27fd72-6085-4576-a2fa-e8ee2106903a', 'Liters (L)', '5a896d4b-9d4f-4d1e-b40a-529055896ede', 113.350126, 'l', 'volume', 3, true, 5, 1, false),
-- Coconut water, ₱50-80/L
  (142, 'Coconut Water', 'Beverages, Drinks & Syrups', 'wet', '0c27fd72-6085-4576-a2fa-e8ee2106903a', 'Liters (L)', '5a896d4b-9d4f-4d1e-b40a-529055896ede', 60, 'l', 'volume', 3, true, 5, 1, false),
-- Orange juice, ₱120-150/L
  (143, 'Orange Juice', 'Beverages, Drinks & Syrups', 'wet', '0c27fd72-6085-4576-a2fa-e8ee2106903a', 'Liters (L)', '5a896d4b-9d4f-4d1e-b40a-529055896ede', 140, 'l', 'volume', 3, true, 5, 1, false),
-- Dried mushrooms, ₱450-550/kg
  (144, 'Dried Mushrooms', 'Dry Goods', 'dry', '37ae550d-5bf5-4b66-8cbf-189aea9b6f91', 'Kilograms (kg)', '0a1080a8-68fb-4da8-813d-b8f0c49e378d', 500, 'kg', 'mass', 3, true, 3, 1, false),
-- Dried seaweed, ₱400-500/kg
  (145, 'Dried Seaweed', 'Dry Goods', 'dry', '37ae550d-5bf5-4b66-8cbf-189aea9b6f91', 'Kilograms (kg)', '0a1080a8-68fb-4da8-813d-b8f0c49e378d', 450, 'kg', 'mass', 3, true, 3, 1, false),
-- Dried anchovies, ₱350-450/kg
  (146, 'Dried Anchovies', 'Dry Goods', 'dry', '37ae550d-5bf5-4b66-8cbf-189aea9b6f91', 'Kilograms (kg)', '0a1080a8-68fb-4da8-813d-b8f0c49e378d', 400, 'kg', 'mass', 3, true, 3, 1, false),
-- Dried shrimp, ₱550-700/kg
  (147, 'Dried Shrimp', 'Dry Goods', 'dry', '37ae550d-5bf5-4b66-8cbf-189aea9b6f91', 'Kilograms (kg)', '0a1080a8-68fb-4da8-813d-b8f0c49e378d', 600, 'kg', 'mass', 3, true, 3, 1, false),
-- Dried beans, ₱120-150/kg
  (148, 'Dried Beans', 'Dry Goods', 'dry', '37ae550d-5bf5-4b66-8cbf-189aea9b6f91', 'Kilograms (kg)', '0a1080a8-68fb-4da8-813d-b8f0c49e378d', 130, 'kg', 'mass', 3, true, 5, 1, false),
-- Peanuts, ₱110-150/kg
  (149, 'Peanuts', 'Dry Goods', 'dry', '37ae550d-5bf5-4b66-8cbf-189aea9b6f91', 'Kilograms (kg)', '0a1080a8-68fb-4da8-813d-b8f0c49e378d', 130, 'kg', 'mass', 3, true, 5, 1, false),
-- Sesame seeds, ₱180-220/kg
  (150, 'Sesame Seeds', 'Dry Goods', 'dry', '37ae550d-5bf5-4b66-8cbf-189aea9b6f91', 'Kilograms (kg)', '0a1080a8-68fb-4da8-813d-b8f0c49e378d', 200, 'kg', 'mass', 3, true, 3, 1, false),
-- Corn kernels, ₱100-130/kg
  (151, 'Corn Kernels', 'Dry Goods', 'dry', '37ae550d-5bf5-4b66-8cbf-189aea9b6f91', 'Kilograms (kg)', '0a1080a8-68fb-4da8-813d-b8f0c49e378d', 110, 'kg', 'mass', 3, true, 5, 1, false),
-- Breadcrumbs, ₱80-100/kg
  (152, 'Breadcrumbs', 'Dry Goods', 'dry', '37ae550d-5bf5-4b66-8cbf-189aea9b6f91', 'Kilograms (kg)', '0a1080a8-68fb-4da8-813d-b8f0c49e378d', 90, 'kg', 'mass', 3, true, 5, 1, false),
-- Panko, ₱120-180/kg
  (153, 'Panko', 'Dry Goods', 'dry', '37ae550d-5bf5-4b66-8cbf-189aea9b6f91', 'Kilograms (kg)', '0a1080a8-68fb-4da8-813d-b8f0c49e378d', 150, 'kg', 'mass', 3, true, 5, 1, false),
-- Catering aluminium foil, ₱250-400/kg (supplier quote estimate)
  (154, 'Aluminum Foil', 'Packaging & Supplies', 'dry', '0c994f00-bca2-462f-8c13-386aafadc62b', 'Kilograms (kg)', '0a1080a8-68fb-4da8-813d-b8f0c49e378d', 300, 'kg', 'mass', 3, true, 3, 1, false),
-- Pork, meat with bones ₱301.06/kg (PSA Aug 2026)
  (155, 'Pork', 'Meat & Poultry', 'wet', '15bac7ce-21cb-4ddd-ba44-a08e249c299d', 'Kilograms (kg)', '0a1080a8-68fb-4da8-813d-b8f0c49e378d', 300, 'kg', 'mass', 3, true, 2.9, 0, false),
-- Chicken egg, retail ₱9.17-9.24/pc (PSA May 2026); 30-egg tray ₱255
  (156, 'Egg', 'Meat & Poultry', 'wet', '15bac7ce-21cb-4ddd-ba44-a08e249c299d', 'Pieces (pcs)', 'c3066954-1aed-44fc-acf6-67754b25ad72', 8.5, 'pcs', 'count', 3, false, 36, 0, false),
-- Owner's price kept per individual piece
  (157, 'Lemon Square Cheese Cake', 'Dry Goods', 'dry', '37ae550d-5bf5-4b66-8cbf-189aea9b6f91', 'Pieces (pcs)', 'c3066954-1aed-44fc-acf6-67754b25ad72', 8.9, 'pcs', 'count', 3, false, 10, 0, false),
-- Owner's price kept (₱10 per cookie)
  (158, 'Oreo Original Cookies', 'Dry Goods', 'dry', '37ae550d-5bf5-4b66-8cbf-189aea9b6f91', 'Pieces (pcs)', 'c3066954-1aed-44fc-acf6-67754b25ad72', 10, 'pcs', 'count', 3, false, 18, 0, false),
-- Owner's price kept (frozen fries)
  (159, 'Fries', 'Grains, Noodles & Starches', 'dry', '1fb52812-db0e-4591-9aa9-964f8c031e69', 'Kilograms (kg)', '0a1080a8-68fb-4da8-813d-b8f0c49e378d', 150, 'kg', 'mass', 3, true, 0, 0, false),
-- Owner's price kept (₱2.80/kg, 50 kg for ₱140)
  (160, 'Cucumber Calamansi Juice', 'Beverages, Drinks & Syrups', 'dry', '0c27fd72-6085-4576-a2fa-e8ee2106903a', 'Kilograms (kg)', '0a1080a8-68fb-4da8-813d-b8f0c49e378d', 2.8, 'kg', 'mass', 3, true, 3, 0, false),
-- Owner's receipt kept (500 g for ₱165)
  (161, 'Red Ice Tea Powder', 'Beverages, Drinks & Syrups', 'dry', '0c27fd72-6085-4576-a2fa-e8ee2106903a', 'Grams (g)', 'deebea71-107a-4619-8a3f-65f103b8ee08', 0.33, 'g', 'mass', 3, true, 0, 0, false),
-- Owner's receipt kept (9 pcs for ₱295)
  (162, 'Pampanga''s Best Hungarian Sausage Cheese', 'Meat & Poultry', 'wet', '15bac7ce-21cb-4ddd-ba44-a08e249c299d', 'Pieces (pcs)', 'c3066954-1aed-44fc-acf6-67754b25ad72', 32.777778, 'pcs', 'count', 3, false, 0, 0, false),
-- Owner's receipt kept (500 g for ₱165)
  (163, 'Powder Mix (Blue Lemonade)', 'Beverages, Drinks & Syrups', 'dry', '0c27fd72-6085-4576-a2fa-e8ee2106903a', 'Grams (g)', 'deebea71-107a-4619-8a3f-65f103b8ee08', 0.33, 'g', 'mass', 3, true, 50, 0, false),
-- Owner's receipt kept (220 g for ₱63)
  (164, 'Pampanga''s Best Tocino', 'Meat & Poultry', 'wet', '15bac7ce-21cb-4ddd-ba44-a08e249c299d', 'Grams (g)', 'deebea71-107a-4619-8a3f-65f103b8ee08', 0.286364, 'g', 'mass', 3, true, 11, 0, false),
-- Owner's receipt kept (50 g for ₱125)
  (165, 'Strawberry Powder', 'Beverages, Drinks & Syrups', 'dry', '0c27fd72-6085-4576-a2fa-e8ee2106903a', 'Grams (g)', 'deebea71-107a-4619-8a3f-65f103b8ee08', 2.5, 'g', 'mass', 3, true, 10, 0, false)
ON CONFLICT (id) DO UPDATE SET
  name            = EXCLUDED.name,
  category        = EXCLUDED.category,
  material_type   = EXCLUDED.material_type,
  category_id     = EXCLUDED.category_id,
  unit            = EXCLUDED.unit,
  unit_id         = EXCLUDED.unit_id,
  price           = EXCLUDED.price,
  base_unit       = EXCLUDED.base_unit,
  unit_family     = EXCLUDED.unit_family,
  stock_scale     = EXCLUDED.stock_scale,
  allow_fractional= EXCLUDED.allow_fractional;
-- quantity / min_stock / is_archived are intentionally NOT updated.

COMMIT;
