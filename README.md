<div align="center">

# Demand Forecasting System

**Know what to cook and what to buy before the day starts.**

A web-based demand forecasting and supply chain decision support system for a Filipino micro food service business. It forecasts how many of each menu item will sell, turns that into the ingredients needed, and helps the owner plan restocking.

![React](https://img.shields.io/badge/React-Vite-61DAFB?logo=react&logoColor=black)
![Node.js](https://img.shields.io/badge/Node.js-Express-339933?logo=node.js&logoColor=white)
![Python](https://img.shields.io/badge/Python-Flask-3776AB?logo=python&logoColor=white)
![XGBoost](https://img.shields.io/badge/ML-XGBoost-EB5B25)
![Supabase](https://img.shields.io/badge/Database-Supabase-3FCF8E?logo=supabase&logoColor=white)

[The Problem](#the-problem) •
[The Solution](#the-solution) •
[Features](#features) •
[How the Forecast Works](#how-the-forecast-works) •
[Tech Stack](#tech-stack)

</div>

> [!IMPORTANT]
> **The system recommends. The owner decides.** Forecasts and grocery lists support decisions; they don't replace the owner's judgment.

---

<a id="the-problem"></a>

## <img src="https://api.iconify.design/lucide/puzzle.svg?color=%23EB5B25" width="24" height="24" alt="" /> The Problem

Micro food service businesses plan their daily prep and market runs from memory and gut feel. Sales change by weekday and around paydays, and most dishes are made to order from perishable ingredients.

The result: best-sellers run out mid-day, slow items are overstocked, and the owner has no clear view of which products carry the business. Commercial forecasting tools are built for larger companies with years of clean data, not a small store with a daily POS export.

<a id="the-solution"></a>

## <img src="https://api.iconify.design/lucide/lightbulb.svg?color=%23EB5B25" width="24" height="24" alt="" /> The Solution

The system turns the store's daily sales records into a forecast, an ingredient need, and a restocking plan.

| # | Step | What happens |
| :--: | :-- | :-- |
| **1** | **Upload** | The owner uploads daily sales (CSV or Excel). The file is checked and previewed before import. |
| **2** | **Account for every day** | Each date is marked as an open day or a closed day, so gaps don't mislead the model. |
| **3** | **Train** | Once there is enough history, an XGBoost model learns the store's sales patterns. |
| **4** | **Forecast** | Each morning, the system forecasts the quantity of each menu item to be sold. |
| **5** | **Plan ingredients** | Forecast × recipe × safety buffer = ingredients needed, compared against current stock. |
| **6** | **Act** | Stock alerts, a grocery list with estimated costs, and downloadable reports. |

```mermaid
flowchart LR
    A[Sales Upload] --> B[Validate]
    B --> C[Open / Closed Days]
    C --> D[XGBoost Training]
    D --> E[Daily Forecast]
    E --> F[Ingredient Demand]
    F --> G[Stock Alerts · Grocery List · Reports]
```

---

<a id="features"></a>

## <img src="https://api.iconify.design/lucide/layout-grid.svg?color=%23EB5B25" width="24" height="24" alt="" /> Features

| Module | What it does |
| :-- | :-- |
| <img src="https://api.iconify.design/lucide/layout-dashboard.svg?color=%23EB5B25" width="20" height="20" alt="" /> **Dashboard** | Today's forecast, recent sales, forecast accuracy, and stock alerts at a glance. Guides the owner through setup until forecasts are ready. |
| <img src="https://api.iconify.design/lucide/folder-up.svg?color=%23EB5B25" width="20" height="20" alt="" /> **Data Management** | Upload sales files, view historical data, and mark closed days. |
| <img src="https://api.iconify.design/lucide/package.svg?color=%23EB5B25" width="20" height="20" alt="" /> **Inventory Management** | Ingredients, recipes, stock levels, restocking, and market price reference. |
| <img src="https://api.iconify.design/lucide/trending-up.svg?color=%23EB5B25" width="20" height="20" alt="" /> **Analytics** | Demand forecasting, forecast accuracy, product performance, and demand classification (high, medium, low). |
| <img src="https://api.iconify.design/lucide/shopping-cart.svg?color=%23EB5B25" width="20" height="20" alt="" /> **Ingredient Demand** | Ingredients needed for the forecast and a grocery list of what to buy. |
| <img src="https://api.iconify.design/lucide/bell.svg?color=%23EB5B25" width="20" height="20" alt="" /> **Notifications** | Upload reminders, low-stock alerts, and new or discontinued product detection. |
| <img src="https://api.iconify.design/lucide/settings.svg?color=%23EB5B25" width="20" height="20" alt="" /> **Settings** | Business profile, forecast settings (safety buffer), stock thresholds, data management, and audit trail. |
| <img src="https://api.iconify.design/lucide/file-text.svg?color=%23EB5B25" width="20" height="20" alt="" /> **Reports** | PDF and Excel exports for forecasts, performance, and purchasing. |

---

<a id="how-the-forecast-works"></a>

## <img src="https://api.iconify.design/lucide/brain-circuit.svg?color=%23EB5B25" width="24" height="24" alt="" /> How the Forecast Works

<details open>
<summary><img src="https://api.iconify.design/lucide/boxes.svg?color=%23EB5B25" width="18" height="18" alt="" /> <b>One model for the whole menu</b></summary>

<br />

A single **XGBoost** model is trained on the sales history of every active product at once, with the product as one of its inputs. Products with few sales can still learn weekday and payday patterns from the rest of the menu.

The model predicts **quantity sold**, not revenue.

</details>

<details open>
<summary><img src="https://api.iconify.design/lucide/list-checks.svg?color=%23EB5B25" width="18" height="18" alt="" /> <b>What the model looks at</b></summary>

<br />

| Group | Inputs |
| :-- | :-- |
| Product | Which menu item |
| Calendar | Day of week, month, day of month, weekend, payday |
| Recent sales | Yesterday's sales, same weekday last open day, days since last open day, 7-day and 14-day averages |

</details>

<details open>
<summary><img src="https://api.iconify.design/lucide/flask-conical.svg?color=%23EB5B25" width="18" height="18" alt="" /> <b>How it is evaluated</b></summary>

<br />

- Data is split **by date, never at random**, so the model is always tested on days it has never seen.
- Accuracy is measured with **WMAPE** (weighted mean absolute percentage error), alongside MAE and RMSE.
- The model is always compared against simple baselines, such as the 7-day average, to check that it adds real value.

</details>

---

<a id="tech-stack"></a>

## <img src="https://api.iconify.design/lucide/layers.svg?color=%23EB5B25" width="24" height="24" alt="" /> Tech Stack

| Layer | Technology |
| :-- | :-- |
| Frontend | React, Vite, Recharts |
| Backend API | Node.js, Express |
| Machine Learning | Python, Flask, XGBoost, pandas, scikit-learn |
| Database & Auth | Supabase (PostgreSQL) |

```mermaid
flowchart LR
    U[Web App<br/>React] --> API[API<br/>Node + Express]
    API --> ML[ML Service<br/>Flask + XGBoost]
    API --> DB[(Supabase)]
    ML --> DB
```

---

<a id="data-privacy"></a>

## <img src="https://api.iconify.design/lucide/shield-check.svg?color=%23EB5B25" width="24" height="24" alt="" /> Data Privacy

This system was built for a real client. Client sales records, business details, and credentials are kept private and are not shared in this README. Access to the system requires an owner account.

---

<a id="about-this-project"></a>

## <img src="https://api.iconify.design/lucide/graduation-cap.svg?color=%23EB5B25" width="24" height="24" alt="" /> About This Project

Capstone project for the **BS Information Technology** program at **Pamantasan ng Lungsod ng Pasig**:

**Demand Forecasting System for Supply Chain Decision Support in Micro Enterprise Food Service Using eXtreme Gradient Boost (XGBoost)**

Intended for academic and research purposes.

<!-- Team: add each member's name, role, and GitHub link here. -->

---

<div align="center">

Made for Filipino micro food businesses — *less guessing, less waste.*

</div>
