import constants from '../core/constants';
import MetadataApi from '../data/MetadataApi';
import NotificationsApi from '../data/NotificationsApi';
import history from '../core/history';
import utils from '../core/utils';

class RecipeApi {
  constructor() {
    this.recipe = undefined;
  }

  // Get the recipe details, and its dependencies
  // Object layout is:
  // {recipes: [{recipe: RECIPE, modules: NEVRA, dependencies: NEVRA}, ...]}
  // Where RECIPE is a recipe object
  // NEVRA is a list of name, epoch, version, release, arch objects.
  // "modules" are the specific versions for the recipe's modules and packages
  // "dependencies" are all the things that are required to satisfy the recipe
  getRecipe(recipeName) {
    const p = new Promise((resolve, reject) => {
      utils.apiFetch(constants.get_recipes_deps + recipeName)
            .then(data => {
              // bdcs-api v0.3.0 includes module (component) and dependency NEVRAs
              // tagging all dependencies a "RPM" for now
              const dependencies = data.recipes[0].dependencies ?
                  this.makeRecipeDependencies(data.recipes[0].dependencies, 'RPM') :
                  [];
              // Tag objects as Module if modules and RPM if packages, for now
              const components = this.makeRecipeComponents(data.recipes[0]);
              const recipe = data.recipes[0].recipe;
              if (components.length > 0) {
                const componentNames = MetadataApi.getNames(components);
                if (dependencies.length === 0) {
                    // get metadata for the components only
                  Promise.all([
                    MetadataApi.getData(constants.get_projects_info + componentNames),
                  ]).then((compData) => {
                    recipe.components = MetadataApi.updateComponentMetadata(components, compData[0]);
                    recipe.dependencies = [];
                    this.recipe = recipe;
                    resolve(recipe);
                  }).catch(e => console.log(`getRecipe: Error getting component metadata: ${e}`));
                } else {
                    // get metadata for the components
                    // get metadata for the dependencies
                    // get dependencies for dependencies
                  const dependencyNames = MetadataApi.getNames(dependencies);
                  Promise.all([
                    MetadataApi.getData(constants.get_projects_info + componentNames),
                    MetadataApi.getData(constants.get_projects_info + dependencyNames),
                  ]).then((compData) => {
                    recipe.components = MetadataApi.updateComponentMetadata(components, compData[0]);
                    recipe.dependencies = MetadataApi.updateComponentMetadata(dependencies, compData[1]);
                    this.recipe = recipe;
                    resolve(recipe);
                  }).catch(e => console.log(`getRecipe: Error getting component and dependency metadata: ${e}`));
                }
              } else {
                  // there are no components, just a recipe name and description
                recipe.components = [];
                recipe.dependencies = [];
                this.recipe = recipe;
                resolve(recipe);
              }
            })
            .catch(e => {
              console.log(`Error fetching recipe: ${e}`);
              reject();
            });
    });
    return p;
  }

  // set additional metadata for each of the components
  makeRecipeComponents(data) {
    let components = data.modules;
    components = this.setType(components, data.recipe.modules, 'Module');
    components = this.setType(components, data.recipe.packages, 'RPM');
    components.map(i => {
      i.inRecipe = true; // eslint-disable-line no-param-reassign
      i.user_selected = true; // eslint-disable-line no-param-reassign
      return i;
    });
    return components;
  }

  setType(components, array, type) {
    for (const i of array) {
      // find the array object within components; set ui_type and version for component
      const component = components.find(x => x.name === i.name);
      component.ui_type = type;
      component.version = i.version;
    }
    return components;
  }

  // set additional metadata for each of the dependencies
  makeRecipeDependencies(components, uiType) {
    return components.map(i => {
      i.inRecipe = true; // eslint-disable-line no-param-reassign
      i.ui_type = uiType; // eslint-disable-line no-param-reassign
      return i;
    });
  }

// update Recipe on Add or Remove component
  updateRecipe(component, action) {
    const recipeComponent = {
      name: component.name,
      version: component.version,
    };
    // action is add or remove, and maybe update
    if (action === 'add') {
      if (component.ui_type === 'Module') {
        this.recipe.modules.push(recipeComponent);
      } else if (component.ui_type === 'RPM') {
        this.recipe.packages.push(recipeComponent);
      }
    }
    if (action === 'edit') {
      if (component.ui_type === 'Module') {
        // comment the following two lines to fix eslint no-unused-vars error
        // let updatedComponent = this.recipe.modules.filter((obj) => (obj.name === recipeComponent.name))[0];
        // updatedComponent = Object.assign(updatedComponent, recipeComponent);
      } else if (component.ui_type === 'RPM') {
        // comment the following two lines to fix eslint no-unused-vars error
        // let updatedComponent = this.recipe.packages.filter((obj) => (obj.name === recipeComponent.name))[0];
        // updatedComponent = Object.assign(updatedComponent, recipeComponent);
      }
    }
    if (action === 'remove') {
      if (component.ui_type === 'Module') {
        this.recipe.modules = this.recipe.modules.filter(
          (obj) => (!(obj.name === recipeComponent.name && obj.version === recipeComponent.version))
        );
      } else if (component.ui_type === 'RPM') {
        this.recipe.packages = this.recipe.packages.filter(
          (obj) => (!(obj.name === recipeComponent.name && obj.version === recipeComponent.version))
        );
      }
    }
  }

  handleCreateRecipe(event, recipe) {
    return this.postRecipe(recipe).then(() => {
      window.location.hash = history.createHref(`/edit/${recipe.name}`);
    }).catch((e) => { console.log(`Error creating recipe: ${e}`); });
  }
  handleSaveRecipe() {
    // create recipe and post it
    const recipe = {
      name: this.recipe.name,
      description: this.recipe.description,
      version: this.recipe.version,
      modules: this.recipe.modules,
      packages: this.recipe.packages,
    };
    const p = new Promise((resolve, reject) => {
      this.postRecipe(recipe)
      .then(() => {
        NotificationsApi.closeNotification(undefined, 'saving');
        NotificationsApi.displayNotification(this.recipe.name, 'saved');
        resolve();
      }).catch(e => {
        console.log(`Error saving recipe: ${e}`);
        NotificationsApi.displayNotification(this.recipe.name, 'saveFailed');
        reject();
      });
    });
    return p;
  }

  handleEditDescription(description) {
    // update cached recipe data
    this.recipe.description = description;
    // create recipe variable to post updates
    const recipe = {
      name: this.recipe.name,
      description,
      version: this.recipe.version,
      modules: this.recipe.modules,
      packages: this.recipe.packages,
    };
    const p = new Promise((resolve, reject) => {
      this.postRecipe(recipe)
      .then(() => {
        resolve();
      }).catch(e => {
        console.log(`Error updating recipe description: ${e}`);
        reject();
      });
    });
    return p;
  }

  postRecipe(recipe) {
    return utils.apiFetch(constants.post_recipes_new, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(recipe),
    }, true);
  }

  reloadRecipeDetails() {
    // retrieve recipe details that were updated during save (i.e. version)
    // and reload details in UI
    const p = new Promise((resolve, reject) => {
      utils.apiFetch(constants.get_recipes_deps + this.recipe.name.replace(/\s/g, '-'))
      .then(data => {
        const recipe = data.recipes[0].recipe;
        this.recipe.version = recipe.version;
        resolve(recipe);
      })
      .catch(e => {
        console.log(`Error fetching recipe details: ${e}`);
        reject();
      });
    });
    return p;
  }

  deleteRecipe(recipes) {
    // /api/v0/recipes/delete/<recipe>
    return utils.apiFetch(constants.delete_recipe + recipes, {
      method: 'DELETE',
    }, true);
  }

}

export default new RecipeApi();
