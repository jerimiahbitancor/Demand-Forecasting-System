# Sales Forecasting System for Supply Chain Decision Support in Micro Enterprise Food Service Using eXtreme Gradient Boost (XGBoost)

## Abstract

This project presents a **Sales Forecasting System for Supply Chain Decision Support in Micro Enterprise Food Service Using eXtreme Gradient Boost (XGBoost)**. The system is designed to assist micro food service enterprises in forecasting product demand, optimizing ingredient procurement, and supporting inventory-related decision-making through data-driven insights.

By leveraging historical sales data and machine learning techniques, particularly the XGBoost algorithm, the system generates accurate sales forecasts that help business owners anticipate future demand, reduce stock shortages, minimize food waste, and improve operational efficiency.

The platform provides forecasting analytics, product performance analysis, ingredient requirement recommendations, and automated alerts to support informed supply chain planning.

---

# Objectives

### General Objective

To develop a sales forecasting and supply chain decision support system for micro food service enterprises using the eXtreme Gradient Boost (XGBoost) machine learning algorithm.

### Specific Objectives

* Forecast daily, weekly, and monthly product sales.
* Evaluate forecasting performance through accuracy metrics.
* Identify high-demand and low-demand products.
* Estimate ingredient requirements based on forecasted demand.
* Generate replenishment and reorder recommendations.
* Detect newly introduced and discontinued products.
* Provide visual analytics and business insights for decision-making.

---

# System Features

## 1. User Authentication

### Registration

* Create a new account.
* Secure user registration process.

### Login

* User authentication and access management.

### Forgot Password

* Password recovery and account restoration.

---

## 2. Dashboard

### First-Time User Onboarding

Displayed once upon first login.

#### Features

* Welcome Message
* System Description
* User Manual Guide
* System Workflow Explanation
* Terms and Conditions
* Privacy Policy

---

### Existing User Dashboard

#### KPI Cards

1. Predicted Sales (Today)
2. Actual Sales (Yesterday)
3. Forecast Accuracy Score
4. Stock Requirement Alerts

#### Dashboard Components

* Sales Overview Graph

  * Actual Sales
  * Forecasted Sales
  * Future Forecast

* Sales Calendar and Events

* Product Performance Analysis

  * Best Selling Products
  * Demand Trends

* Ingredient Requirement Panel

  * Forecast-based ingredient recommendations

---

## 3. Data Management

### Sales Data Upload

* CSV Upload
* Excel Upload
* Data Validation
* Preview Before Import

### Historical Data Storage

* View Uploaded Data
* Filter Records
* Delete Upload Batches

### Menu and Ingredient Mapping

* Upload Recipe Mapping Files
* Product-to-Ingredient Association

---

## 4. Analytics Module

### Sales Forecasting

#### Features

* Daily Sales Forecast
* Weekly Sales Forecast
* Monthly Sales Forecast
* Product-Level Forecasting

#### Forecast Accuracy

* Accuracy Monitoring
* Forecast Error Analysis

#### Model Insights

* XGBoost Feature Importance
* Trend Analysis

#### Report Generation

* PDF Export
* Excel Export

---

### Product Performance Analytics

#### Demand Classification

* High Demand
* Medium Demand
* Low Demand

#### Performance Ratio Analysis

* Best Sellers
* Low Sellers

#### Product Lifecycle Monitoring

* New Product Detection
* Discontinued Product Detection

#### Report Generation

* PDF Export
* Excel Export

---

### Supply Chain Decision Support

#### Reorder Point Alerts

* Safety Stock Recommendation
* Demand-Based Replenishment Suggestions

#### Supplier Order List Generator

* Forecast-Based Procurement List
* Ingredient Demand Estimation

> Note: The system does not track current inventory levels. Recommendations are generated solely from forecasted demand and historical sales patterns.

#### Report Generation

* PDF Export
* Excel Export

---

## 5. Alerts and Notifications

### Alert Types

#### Low Stock/Replenishment Alert

Provides warnings when forecasted demand may exceed available supply estimates.

#### High Demand Warning

Alerts users of expected sales surges.

#### Unusual Sales Drop Alert

Detects significant decreases in product demand.

#### Upload Reminder

Reminds users to upload recent sales data.

#### New Product Detection

"New product detected. Forecast available after 4 weeks of sales history."

#### Discontinued Product Detection

"Product automatically flagged after 28 consecutive days with no sales activity. Excluded from forecasting."

---

## 6. Settings

### Business Profile

* Business Name
* Address
* Logo
* Owner Information

### Account Settings

* Username
* Password
* Email Management

### Forecast Configuration

* Safety Buffer Percentage
* Staff Consumption Buffer

### Data Management Settings

* Backup Data
* Export All Data
* Clear Historical Records

### About and Documentation

* User Guide
* Technical Documentation
* System Information

---

# Machine Learning Model

## Algorithm

**eXtreme Gradient Boosting (XGBoost)**

### Why XGBoost?

* High forecasting accuracy
* Handles non-linear sales patterns
* Robust against missing values
* Fast training and prediction performance
* Effective for time-series demand forecasting

### Input Variables

Examples include:

* Historical Sales Quantity
* Date Information
* Day of Week
* Month
* Seasonal Patterns
* Holidays and Events
* Product Information

### Output

* Forecasted Product Demand
* Predicted Sales Quantity
* Ingredient Requirement Estimates

---

# Technology Stack

## Frontend

* React.js / Next.js
* Tailwind CSS
* Chart.js / Recharts

## Backend

* Node.js
* Express.js

## Database

* MySQL / PostgreSQL

## Machine Learning

* Python
* XGBoost
* Pandas
* NumPy
* Scikit-learn

## Reporting

* PDF Export
* Excel Export

---

# Expected Benefits

* Improved demand forecasting accuracy
* Better procurement planning
* Reduced stock shortages
* Reduced food waste
* Data-driven decision making
* Enhanced operational efficiency for micro food service enterprises

---


# Researchers

Developed as a Capstone/Thesis Project entitled:

**Sales Forecasting System for Supply Chain Decision Support in Micro Enterprise Food Service Using eXtreme Gradient Boost (XGBoost)**


---

# License

This project is intended for academic and research purposes.



