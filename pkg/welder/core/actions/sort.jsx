export const RECIPES_SORT_SET_KEY = 'RECIPES_SORT_SET_KEY';
export const recipesSortSetKey = (key) => ({
  type: RECIPES_SORT_SET_KEY,
  payload: {
    key,
  },
});

export const RECIPES_SORT_SET_VALUE = 'RECIPES_SORT_SET_VALUE';
export const recipesSortSetValue = (value) => ({
  type: RECIPES_SORT_SET_VALUE,
  payload: {
    value,
  },
});

export const DEPENDENCIES_SORT_SET_KEY = 'DEPENDENCIES_SORT_SET_KEY';
export const dependenciesSortSetKey = (key) => ({
  type: DEPENDENCIES_SORT_SET_KEY,
  payload: {
    key,
  },
});

export const DEPENDENCIES_SORT_SET_VALUE = 'DEPENDENCIES_SORT_SET_VALUE';
export const dependenciesSortSetValue = (value) => ({
  type: DEPENDENCIES_SORT_SET_VALUE,
  payload: {
    value,
  },
});

export const COMPONENTS_SORT_SET_KEY = 'COMPONENTS_SORT_SET_KEY';
export const componentsSortSetKey = (key) => ({
  type: COMPONENTS_SORT_SET_KEY,
  payload: {
    key,
  },
});

export const COMPONENTS_SORT_SET_VALUE = 'COMPONENTS_SORT_SET_VALUE';
export const componentsSortSetValue = (value) => ({
  type: COMPONENTS_SORT_SET_VALUE,
  payload: {
    value,
  },
});
