import constants from './constants';
import RecipeApi from '../data/RecipeApi';
import MetadataApi from '../data/MetadataApi';
import utils from './utils';

export function createRecipeApi(events, recipe) {
  RecipeApi.handleCreateRecipe(events, recipe);
}

export function fetchRecipeContentsApi(recipeName) {
  const recipeContents = Promise.all([RecipeApi.getRecipe(recipeName)])
    .then(data => {
      const recipe = data[0];
      recipe.id = recipeName;
      return recipe;
    })
    .catch(err => console.log(`Error in fetchModalRecipeContents promise: ${err}`));
  return recipeContents;
}

export function fetchRecipeInputsApi(filter, selectedInputPage, pageSize) {
  const page = selectedInputPage * pageSize;
  const p = new Promise((resolve, reject) => {
      // /modules/list looks like:
      // {"modules":[{"name":"389-ds-base","group_type":"rpm"},{"name":"389-ds-base-libs","group_type":"rpm"}, ...]}
    utils.apiFetch(`${constants.get_modules_list + filter}?limit=${pageSize}&offset=${page}`)
      .then(data => {
        const total = data.total;
        let components = data.modules;
        const componentNames = MetadataApi.getNames(components);
        Promise.all([
          MetadataApi.getData(constants.get_projects_info + componentNames),
        ]).then((result) => {
          components = MetadataApi.updateInputMetadata(components, result[0], true);
          components.map(i => { i.ui_type = 'RPM'; return i; }); // eslint-disable-line no-param-reassign
          resolve([components, total]);
        }).catch(e => console.log(`Error getting recipe metadata: ${e}`));
      })
      .catch(e => {
        console.log(`Failed to get inputs during recipe edit: ${e}`);
        reject();
      });
  });
  return p;
}

export function fetchRecipeNamesApi() {
  const recipeNames = utils.apiFetch(constants.get_recipes_list)
    .then(response => response.recipes);
  return recipeNames;
}

export function fetchRecipeInfoApi(recipeName) {
  const recipeFetch = utils.apiFetch(constants.get_recipes_info + recipeName)
    .then(recipedata => {
      if (recipedata.recipes.length > 0) {
        const recipe = recipedata.recipes[0];
        recipe.id = recipeName;
        return recipe;
      }
      return null;
    });
  return recipeFetch;
}

export function fetchModalCreateCompositionTypesApi() {
  const compostionTypes = utils.apiFetch(constants.get_compose_types)
    .then(data => data.types)
    .catch(e => console.log(`Error getting component types: ${e}`));
  return compostionTypes;
}

export function setRecipeDescriptionApi(recipe, description) {
  RecipeApi.handleEditDescription(description);
}

export function deleteRecipeApi(recipe) {
  const deletedRecipe = Promise.all([RecipeApi.deleteRecipe(recipe)])
    .then(() => recipe);
  return deletedRecipe;
}
