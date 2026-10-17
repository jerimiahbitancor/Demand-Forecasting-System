// notificationLinks.js
//
// One place to decide where a notification takes the owner.
//
// Most notification links are real routes and are used as-is. Two are not:
//
//  - "/ingredient-management" is no longer a page — it is the first tab of
//    Inventory Management — so it is remapped to /inventory-management.
//
//  - "/ingredient-demand" is the grocery list. It is the Ingredient Demand
//    *tab* of the Analytics page, not a standalone page, so it opens the
//    Analytics page with that tab selected. Rendering the bare component
//    skipped the Analytics chrome (navbar, tab bar, breadcrumb) and left the
//    owner on a page they could not navigate away from.
export const resolveNotificationLink = (notification) => {
  const link = notification?.link;
  if (!link) return null;

  if (link === '/ingredient-management') {
    return '/inventory-management';
  }

  if (link === '/ingredient-demand' || link.startsWith('/ingredient-demand?')) {
    return '/analytics?tab=ingredient-demand';
  }

  return link;
};

export default resolveNotificationLink;
