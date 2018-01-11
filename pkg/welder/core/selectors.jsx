import { createSelector } from 'reselect';

const getPastLength = (recipe) => {
  const pastLength = recipe.past.length;
  return pastLength;
};

export const makeGetPastLength = () => createSelector(
  [getPastLength],
  (pastLength) => pastLength
);

const getFutureLength = (recipe) => {
  const futureLength = recipe.future.length;
  return futureLength;
};

export const makeGetFutureLength = () => createSelector(
  [getFutureLength],
  (futureLength) => futureLength
);

const getRecipeById = (state, recipeId) => {
  const recipeById = state.recipes.find(recipe => recipe.present.id === recipeId);
  return recipeById;
};

export const makeGetRecipeById = () => createSelector(
  [getRecipeById],
  (recipe) => recipe
);

const getSortedComponents = (state, recipe) => {
  // TODO; sort
  const sortedComponents = recipe.components;
  if (sortedComponents === undefined) {
    return [];
  }
  const key = state.sort.components.key;
  const value = state.sort.components.value;
  sortedComponents.sort((a, b) => {
    if (a[key] > b[key]) return value === 'DESC' ? 1 : -1;
    if (b[key] > a[key]) return value === 'DESC' ? -1 : 1;
    return 0;
  });
  return sortedComponents;
};

export const makeGetSortedComponents = () => createSelector(
  [getSortedComponents],
  (components) => components
);

const getSortedDependencies = (state, recipe) => {
  const sortedDependencies = recipe.dependencies;
  if (sortedDependencies === undefined) {
    return [];
  }
  const key = state.sort.dependencies.key;
  const value = state.sort.dependencies.value;
  sortedDependencies.sort((a, b) => {
    if (a[key] > b[key]) return value === 'DESC' ? 1 : -1;
    if (b[key] > a[key]) return value === 'DESC' ? -1 : 1;
    return 0;
  });
  return sortedDependencies;
};

export const makeGetSortedDependencies = () => createSelector(
  [getSortedDependencies],
  (dependencies) => dependencies
);

const getSortedRecipes = (state) => {
  const sortedRecipes = state.recipes;
  const key = state.sort.recipes.key;
  const value = state.sort.recipes.value;
  sortedRecipes.sort((a, b) => {
    if (a.present[key] > b.present[key]) return value === 'DESC' ? 1 : -1;
    if (b.present[key] > a.present[key]) return value === 'DESC' ? -1 : 1;
    return 0;
  });
  return sortedRecipes;
};

export const makeGetSortedRecipes = () => createSelector(
  [getSortedRecipes],
  (recipes) => recipes
);
