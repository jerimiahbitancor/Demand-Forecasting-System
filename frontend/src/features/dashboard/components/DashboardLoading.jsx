// components/DashboardLoading.jsx
//
// The screen shown while Dashboard.jsx is still resolving which of the seven
// dashboard states applies. Before this existed, Dashboard.jsx started on
// 'NoData', so every visit flashed the "no data" screen before swapping to the
// real one — for an owner with a fully trained model that meant watching a
// "upload your data" page appear and vanish.
//
// Deliberately cheap, because it is on the critical path:
//   - CSS-only animation (no JS timers, no requestAnimationFrame loop)
//   - no image assets beyond the Navbar the states render anyway
//   - no numbers. It cannot know how far along it is, so it does not pretend.
//   - reuses the state-kit tokens, so it looks like the screen it hands off to
//     rather than a separate loading theme.
import Navbar from "../../components/Navbar/Navbar";
import "../states/statescss/state-kit.css";

const DashboardLoading = () => (
  <div className="sk-root" role="status" aria-live="polite" aria-busy="true">
    <Navbar />

    <main className="sk-boot">
      <div className="sk-boot-card">

        <h1 className="sk-boot-title">Checking your dashboard</h1>
        <p className="sk-boot-sub">
          Working out which view your sales data calls for.
        </p>

        <div className="sk-boot-bar" aria-hidden="true">
          <span className="sk-boot-bar-fill" />
        </div>

        <p className="sk-boot-note">This usually takes a moment.</p>
      </div>
    </main>
  </div>
);

export default DashboardLoading;