// utils/escapeHtml.js
//
// Escapes text for HTML (email bodies). One function, shared by every
// email builder, so no value is ever put into HTML unescaped.

function escapeHtml(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

module.exports = { escapeHtml };
