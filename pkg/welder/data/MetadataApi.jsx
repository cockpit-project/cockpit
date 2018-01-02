import constants from '../core/constants';
import utils from '../core/utils';

class MetadataApi {

  getData(api) {
    const p = new Promise((resolve) => {
      utils.apiFetch(api)
        .then(data => {
          resolve(data);
        })
        .catch(e => {
          console.log(`Failed to get ${api}${e}`);
        });
    });
    return p;
  }

  getNames(components) {
    let names = '';
    components.map(i => {
      names = names === '' ? i.name : `${names},${i.name}`;
      return i;
    });
    return names;
  }

  getAvailableBuilds(component) {
    // the user clicked Edit when viewing details of a Recipe component
    // a list of available builds are returned for displaying in the edit form
    const p = new Promise((resolve, reject) => {
      Promise.all([
        this.getData(constants.get_projects_info + component.name),
      ]).then((data) => {
        const builds = data[0].projects[0].builds;
        resolve(builds);
      })
      .catch(e => {
        console.log(`Error getting component builds: ${e}`);
        reject();
      });
    });
    return p;
  }

  getMetadataComponent(component, build) {
    // if the user clicked View Details for an available component
    //    then build = "all" and all available builds are returned
    // if the user clicked Add in the sidebar to add the component to the recipe
    //    of if the user clicked the name of any component not available to add
    //    then build = ""

    // get metadata and dependencies for the component
    // bdcs-api v0.3.0 /modules/info looks like:
    // {"modules":[{"name":NAME, ..., "dependencies":[NEVRA, ...]}, ...]}
    const p = new Promise((resolve, reject) => {
      Promise.all([
        this.getData(constants.get_projects_info + component.name),
        this.getData(constants.get_modules_info + component.name),
      ]).then((data) => {
        if ((data[0].projects.length === 0) || (data[1].modules.length === 0)) {
          console.log(`Error fetching metadata for ${component.name}`);
          return;
        }

        const componentData = data[1].modules[0];
        componentData.inRecipe = component.inRecipe;
        componentData.user_selected = component.user_selected;
        componentData.ui_type = component.ui_type;

        // The component's depsolved version may be in .dependencies
        let compNEVRA = componentData.dependencies.filter((obj) => obj.name === component.name);
        if (compNEVRA.length > 0) {
          compNEVRA = compNEVRA[0];
        } else {
            // Missing deps, construct a NEVRA from the build data
          const firstBuild = data[0].projects[0].builds[0];
          compNEVRA = {
            name: component.name,
            version: firstBuild.source.version,
            release: firstBuild.release,
            arch: firstBuild.arch,
            epoch: firstBuild.epoch,
          };
        }

        componentData.version = compNEVRA.version;
        componentData.release = compNEVRA.release;
        componentData.arch = compNEVRA.arch;

        // if the user clicked View Details for an available component
        // then get the list of available builds
        const metadata = (build === 'all') ? [componentData, data[0].projects[0].builds] : [componentData, []];
        resolve(metadata);
      }).catch(e => {
        console.log(`getMetadataComponent: Error getting component: ${e}`);
        reject();
      });
    });
    return p;
  }

  updateInputMetadata(components, data) {
    // for the list of inputs, add the data for additional metadata and return
    data.projects.map(i => {
      const index = components.map(component => component.name).indexOf(i.name);
      components[index].summary = i.summary; // eslint-disable-line no-param-reassign
      components[index].version = i.builds[0].source.version; // eslint-disable-line no-param-reassign
      components[index].release = i.builds[0].release; // eslint-disable-line no-param-reassign
      return i;
    });
    return components;
  }

  updateComponentMetadata(components, data) {
    // for the list of components, add the data for additional metadata and return
    // TODO - create a list of architectures based on the component version-release
    data.projects.map(i => {
      const index = components.map(component => component.name).indexOf(i.name);
      components[index].summary = i.summary; // eslint-disable-line no-param-reassign
      components[index].homepage = i.homepage; // eslint-disable-line no-param-reassign
      return i;
    });
    return components;
  }

  updateRecipeDependencies(component) {
    if (component.projects.length > 0) {
      component.projects.map(i => {
        i.requiredBy = component.name; // eslint-disable-line no-param-reassign
        i.inRecipe = true; // eslint-disable-line no-param-reassign
        i.ui_type = component.ui_type; // eslint-disable-line no-param-reassign
        return i;
      });
    }
    return component.projects;
  }

}

export default new MetadataApi();
