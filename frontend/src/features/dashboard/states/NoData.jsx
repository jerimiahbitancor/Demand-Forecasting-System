// states/NoData.jsx
//
// State 1 of 7 — nothing has been uploaded yet. All it does is explain the
// two setup steps, poll the backend so the owner is moved on automatically
// once data lands, and send them to Data Management / Inventory Management.
import { useState, useEffect, useRef } from "react";
import axios from "axios";
import { useNavigate } from "react-router-dom";
import { FaArrowRight, FaLightbulb } from "react-icons/fa";
import noDataImage from "../../../assets/images/NoData.png";
import { useHelp } from "../../../hooks/useHelp";
import { StateShell, SetupStep, Illustration } from "../components/DashboardStateKit.jsx";

const API_URL = import.meta.env.VITE_API_URL || "http://localhost:5000/api";

const NoData = ({ initialState }) => {
  const navigate = useNavigate();
  const { openHelp } = useHelp();
  // Seeded from the Dashboard's dashboard-state response — its `progress`
  // block is the same getUploadProgress() payload /upload/progress returns, so
  // the bar starts at the real value instead of animating up from zero after
  // the screen appears.
  const [progressPercentage, setProgressPercentage] = useState(
    initialState?.progress?.progress || 0
  );
  const isMountedRef = useRef(true);

  // Navigation handlers
  const handleUploadData = () => {
    navigate("/data-management");
  };

  const handleInventoryManagement = () => {
    navigate("/inventory-management");
  };

  const getAuthToken = () => sessionStorage.getItem("access_token") || localStorage.getItem("token");

  const apiClient = axios.create({
    baseURL: API_URL,
    headers: { "Content-Type": "application/json" },
  });

  apiClient.interceptors.request.use(
    (config) => {
      const token = getAuthToken();
      if (token) config.headers.Authorization = `Bearer ${token}`;
      return config;
    },
    (error) => Promise.reject(error),
  );

  const fetchDataStatus = async () => {
    try {
      const stateResult = await apiClient.get("/upload/dashboard-state");

      if (!stateResult.data.success) return;

      const { state, progress } = stateResult.data.data;
      if (!isMountedRef.current) return;
      setProgressPercentage(progress?.progress || 0);

      if (isMountedRef.current && state !== "no-data") {
        navigate("/dashboard", { replace: true });
      }
    } catch (error) {
      console.error("Error fetching upload progress:", error);
      try {
        const uploadsResponse = await apiClient.get("/upload?limit=1");
        const uploadCount =
          uploadsResponse.data.count || uploadsResponse.data.data?.length || 0;

        if (uploadCount > 0) {
          if (!isMountedRef.current) return;
          setProgressPercentage(Math.min((uploadCount / 12) * 100, 100));
          navigate("/dashboard", { replace: true });
        } else {
          if (!isMountedRef.current) return;
          setProgressPercentage(0);
        }
      } catch (fallbackError) {
        console.error("Error fetching upload fallback:", fallbackError);
        if (isMountedRef.current) setProgressPercentage(0);
      }
    }
  };

  useEffect(() => {
    isMountedRef.current = true;

    // Only re-check immediately when there was nothing to seed from (a direct
    // visit to /dashboard/no-data). Otherwise the Dashboard asked the same
    // endpoint moments ago and 3s from now the poll picks up any change.
    const initialFetch = initialState
      ? null
      : setTimeout(fetchDataStatus, 0);
    const interval = setInterval(() => {
      fetchDataStatus();
    }, 3000);

    return () => {
      isMountedRef.current = false;
      if (initialFetch) clearTimeout(initialFetch);
      clearInterval(interval);
    };
  }, [navigate]);

  return (
    <StateShell
      eyebrow="Getting Started"
      title={<>Nothing uploaded <em>yet</em></>}
      lede="Let's get your dashboard ready. Once your historical sales data is in, this page turns into live demand forecasts, product performance, ingredient requirements and replenishment insights."
      progress={{
        value: progressPercentage,
        caption: "Setup progress across the whole system",
      }}
    >
      <Illustration
        src={noDataImage}
        alt="ChefDuo Forecast illustration"
        copy={
          <div>
            <h2 className="sk-section-title">Two steps to your first forecast</h2>
            <p className="sk-section-sub">
              ChefDuo Forecast learns from your own sales history, so it needs your
              records before it can suggest anything. Complete these two steps and the
              dashboard takes care of the rest.
            </p>
            <div className="sk-tags" style={{ marginTop: 20 }}>
              <span className="sk-tag sk-tag--brand">CSV / XLSX uploads</span>
              <span className="sk-tag">12+ months recommended</span>
              <span className="sk-tag">XGBoost forecasting</span>
            </div>
          </div>
        }
      />

      <section className="sk-section">
        <div className="sk-section-head">
          <div>
            <h2 className="sk-section-title">Complete these steps</h2>
            <p className="sk-section-sub">
              The dashboard moves on by itself as soon as each one is done — no need to
              refresh.
            </p>
          </div>
        </div>

        <div className="sk-grid-2">
          <SetupStep
            index={1}
            title="Upload Historical Sales Data"
            tag={<span className="sk-tag sk-tag--brand">Step 1</span>}
            foot={
              <button type="button" className="sk-btn sk-btn--primary" onClick={handleUploadData}>
                Upload Sales Data
                <FaArrowRight size={15} />
              </button>
            }
          >
            <p className="sk-card-text">
              Export your sales history from your POS system as CSV or XLSX and upload
              it here. At least 12 months gives the model the most reliable signal for
              weekday, weekend, seasonal and payday patterns.
            </p>
            <div className="sk-note" style={{ marginTop: 16 }}>
              <strong>What to include.</strong> Item Name, Category, Item Sold, Gross
              Sales, Refunds and Net Sales.
            </div>
          </SetupStep>

          <SetupStep
            index={2}
            title="Add Ingredient Recipes to Your Products"
            tag={<span className="sk-tag">Step 2</span>}
            foot={
              <button
                type="button"
                className="sk-btn sk-btn--secondary"
                onClick={handleInventoryManagement}
              >
                Go to Inventory Management
                <FaArrowRight size={15} />
              </button>
            }
          >
            <p className="sk-card-text">
              Your menu products are detected automatically from the sales data you
              upload. After uploading, add the ingredient recipe for each product so the
              system can work out how much of every ingredient you need to prepare.
            </p>
            <div className="sk-note" style={{ marginTop: 16 }}>
              Recipes are what turn a product forecast into an ingredient shopping list.
            </div>
          </SetupStep>
        </div>
      </section>

      <section className="sk-section">
        <div className="sk-note sk-note--warn">
          <FaLightbulb
            size={17}
            style={{ color: "var(--sk-amber-ink)", marginRight: 8, verticalAlign: -3 }}
          />
          <strong>Not sure where to start?</strong>{" "}
          <button
            type="button"
            className="sk-linkbtn"
            onClick={() => openHelp("how-it-works")}
          >
            See how ChefDuo Forecast works
          </button>{" "}
        </div>
      </section>
    </StateShell>
  );
};

export default NoData;