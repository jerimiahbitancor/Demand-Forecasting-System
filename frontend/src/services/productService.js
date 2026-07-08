const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:5000/api';

export const productService = {
  getAll: async () => {
    const response = await fetch(`${API_URL}/products`);
    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || 'Failed to load products');
    }

    return data;
  },

  create: async (payload) => {
    const response = await fetch(`${API_URL}/products`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || 'Failed to create product');
    }

    return data;
  },

  update: async (id, payload) => {
    const response = await fetch(`${API_URL}/products/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || 'Failed to update product');
    }

    return data;
  },

  remove: async (id) => {
    const response = await fetch(`${API_URL}/products/${id}`, {
      method: 'DELETE',
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || 'Failed to delete product');
    }

    return data;
  },
};
