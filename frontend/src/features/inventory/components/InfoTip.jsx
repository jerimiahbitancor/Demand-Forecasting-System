import { FaInfoCircle } from "react-icons/fa";
import Tippy from "@tippyjs/react";
import "tippy.js/dist/tippy.css";
import "./InfoTip.css";

// Small "i" next to a form label that reveals the extra explanation on hover /
// focus instead of printing it as a line under the field.
const InfoTip = ({ children, className = "" }) => (
	<Tippy content={<div className="info-tip-content">{children}</div>} placement="top" theme="dark" maxWidth={280}>
		<span className={`info-tip ${className}`} tabIndex={0} role="button" aria-label="More information">
			<FaInfoCircle />
		</span>
	</Tippy>
);

export default InfoTip;
