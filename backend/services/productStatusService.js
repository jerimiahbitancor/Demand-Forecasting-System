const DAY_MS = 24 * 60 * 60 * 1000;

function toDate(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function deriveProductStatus({ firstSoldDate, lastSoldDate, createdAt, isActive = false }) {
  const now = new Date();
  const cutoffDate = new Date(now.getTime() - (28 * DAY_MS));
  const firstDate = toDate(firstSoldDate);
  const lastDate = toDate(lastSoldDate);
  const createdDate = toDate(createdAt);

  if (lastDate && lastDate >= cutoffDate) {
    const hasEnoughHistory = firstDate && firstDate <= new Date(now.getTime() - (28 * DAY_MS));
    if (hasEnoughHistory) {
      return {
        status: 'active',
        label: 'ACTIVE',
        note: '',
        isActive: true,
      };
    }

    return {
      status: 'new',
      label: 'INACTIVE (NEW)',
      note: 'New product detected. Forecast available after 4 weeks.',
      isActive: false,
    };
  }

  if (firstDate && firstDate < cutoffDate) {
    return {
      status: 'inactive',
      label: 'INACTIVE (DISCONTINUED)',
      note: 'Discontinued product. Excluded from forecast.',
      isActive: false,
    };
  }

  if (createdDate && createdDate < cutoffDate) {
    return {
      status: 'inactive',
      label: 'INACTIVE (DISCONTINUED)',
      note: 'Discontinued product. Excluded from forecast.',
      isActive: false,
    };
  }

  return {
    status: 'new',
    label: 'INACTIVE (NEW)',
    note: 'New product detected. Forecast available after 4 weeks.',
    isActive: false,
  };
}

function getStatusText(status) {
  switch (status) {
    case 'active':
      return 'ACTIVE';
    case 'inactive':
      return 'INACTIVE (DISCONTINUED)';
    case 'new':
    default:
      return 'INACTIVE (NEW)';
  }
}

module.exports = {
  deriveProductStatus,
  getStatusText,
};
