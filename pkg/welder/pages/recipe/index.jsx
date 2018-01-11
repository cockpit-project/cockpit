import React from 'react';
import PropTypes from 'prop-types';
import Link from '../../components/Link';
import Layout from '../../components/Layout';
import Tabs from '../../components/Tabs/Tabs';
import Tab from '../../components/Tabs/Tab';
import RecipeContents from '../../components/ListView/RecipeContents';
import ComponentDetailsView from '../../components/ListView/ComponentDetailsView';
import CreateComposition from '../../components/Modal/CreateComposition';
import ExportRecipe from '../../components/Modal/ExportRecipe';
import EmptyState from '../../components/EmptyState/EmptyState';
import ListView from '../../components/ListView/ListView';
import ListItemCompositions from '../../components/ListView/ListItemCompositions';
import ListItemChanges from '../../components/ListView/ListItemChanges';
import { connect } from 'react-redux';
import { fetchingRecipeContents, setRecipeDescription } from '../../core/actions/recipes';
import { setModalExportRecipeVisible } from '../../core/actions/modals';
import {
  setEditDescriptionVisible, setEditDescriptionValue,
  setSelectedComponent, setSelectedComponentStatus, setSelectedComponentParent,
  setActiveTab,
} from '../../core/actions/recipePage';
import {
  componentsSortSetKey, componentsSortSetValue, dependenciesSortSetKey, dependenciesSortSetValue,
} from '../../core/actions/sort';
import { makeGetRecipeById, makeGetSortedComponents, makeGetSortedDependencies } from '../../core/selectors';

class RecipePage extends React.Component {
  constructor() {
    super();
    this.setNotifications = this.setNotifications.bind(this);
    this.handleTabChanged = this.handleTabChanged.bind(this);
    this.handleComponentDetails = this.handleComponentDetails.bind(this);
    this.handleHideModalExport = this.handleHideModalExport.bind(this);
    this.handleShowModalExport = this.handleShowModalExport.bind(this);
    this.handleChangeDescription = this.handleChangeDescription.bind(this);

    this.state = {
      changes: [
        {
          commit: "3eaa3e0f732e37be4629042b8b74a4873ebb9909",
          time: "Thu,  9 Nov 2017 14:50:41 +0000",
          message: "These are comments about the changes that were saved."
        },
        {
          commit: "627a776366f1f89e70d7453e1d7f4c88e9025229",
          time: "Thu,  9 Nov 2017 14:48:49 +0000",
          message:
          "Lorem ipsum dolor sit amet, consectetur adipiscing elit. Curabitur \
          sagittis ullamcorper commodo. Pellentesque vitae arcu non eros \
          tincidunt malesuada."
        },
        {
          commit: "5fc425a221d207393ae3720eaea5cbb9308657c3",
          time: "Wed, 18 Oct 2017 17:44:50 +0000",
          message: "Etiam aliquet elit sit amet mauris pretium, ut hendrerit mauris lacinia."
        },
        {
          commit: "8feb1e64d7e3f9d8a16ec0476bc76447c67d7f63",
          time: "Wed, 18 Oct 2017 17:41:10 +0000",
          message: "Nullam nisl tellus, finibus et porttitor quis, efficitur ac ante."
        },
        {
          commit: "a41325a28174d53ad5e54d2868a0fd312875468f",
          time: "Thu,  5 Oct 2017 19:54:42 +0000",
          message:
          "Mauris tincidunt, tellus id commodo fermentum, tellus nisi elementum \
          nisi, vitae lacinia augue sem eget turpis."
        },
      ],
      compositions: [
        {
          date_created: '2/06/17',
          date_exported: '2/06/17',
          user: 'Brian Johnson',
          type: 'iso',
          change: '3',
          size: '2,345 KB',
        },
        {
          date_created: '1/17/17',
          date_exported: '1/17/17',
          user: 'Brian Johnson',
          type: 'iso',
          change: '2',
          size: '1,234 KB',
        },
      ],
    };
  }

  componentWillMount() {
    if (this.props.rehydrated) {
      this.props.fetchingRecipeContents(this.props.route.params.recipe.replace(/\s/g, '-'));
    }
    this.props.setEditDescriptionVisible(false);
    this.props.setModalExportRecipeVisible(false);
  }
  // Get the recipe details, and its dependencies
  // Object layout is:
  // {recipes: [{recipe: RECIPE, modules: MODULES}, ...]}
  // Where MODULES is a modules/info/ object {name: "", projects: [{...

  componentDidMount() {
    document.title = 'Recipe';
  }

  setNotifications() {
    this.refs.layout.setNotifications();
  }

  handleTabChanged(e) {
    if (this.props.recipePage.activeTab !== e.detail) {
      this.props.setActiveTab(e.detail);
    }
    e.preventDefault();
    e.stopPropagation();
  }

  handleComponentDetails(event, component, parent) {
    // the user selected a component to view more details
    this.props.setSelectedComponent(component);
    this.props.setSelectedComponentParent(parent);
    event.preventDefault();
    event.stopPropagation();
  }

  handleEditDescription(action) {
    const state = !this.props.recipePage.editDescriptionVisible;
    this.props.setEditDescriptionVisible(state);
    if (state) {
      this.props.setEditDescriptionValue(this.props.recipe.description);
    } else if (action === 'save') {
      this.props.setRecipeDescription(this.props.recipe, this.props.recipePage.editDescriptionValue);
    } else if (action === 'cancel') {
      // cancel action
    }
  }

  handleChangeDescription(event) {
    this.props.setEditDescriptionValue(event.target.value);
  }

  // handle show/hide of modal dialogs
  handleHideModalExport() {
    this.props.setModalExportRecipeVisible(false);
  }
  handleShowModalExport(e) {
    this.props.setModalExportRecipeVisible(true);
    e.preventDefault();
    e.stopPropagation();
  }
  render() {
    if (!this.props.rehydrated) {
      this.props.fetchingRecipeContents(this.props.route.params.recipe.replace(/\s/g, '-'));
      return <div></div>;
    }

    const {
      recipe, exportModalVisible, compositionTypes, components, dependencies,
    } = this.props;

    const {
      editDescriptionValue, editDescriptionVisible, activeTab,
      selectedComponent, selectedComponentParent, selectedComponentStatus,
    } = this.props.recipePage;

    return (
      <Layout className="container-fluid" ref="layout">
        <header className="cmpsr-header">
          <ol className="breadcrumb">
            <li><Link to="/recipes">Back to Recipes</Link></li>
            <li className="active"><strong>{this.props.route.params.recipe}</strong></li>
          </ol>
          <div className="cmpsr-header__actions">
            <ul className="list-inline">
              <li>
                <Link to={`/edit/${this.props.route.params.recipe}`} className="btn btn-default">Edit Recipe</Link>
              </li>
              <li>
                <button
                  className="btn btn-default"
                  id="cmpsr-btn-crt-compos"
                  data-toggle="modal"
                  data-target="#cmpsr-modal-crt-compos"
                  type="button"
                >
                  Create Composition
                </button>
              </li>
              <li>
                <div className="dropdown dropdown-kebab-pf">
                  <button
                    className="btn btn-link dropdown-toggle"
                    type="button"
                    id="dropdownKebab"
                    data-toggle="dropdown"
                    aria-haspopup="true"
                    aria-expanded="false"
                  >
                    <span className="fa fa-ellipsis-v" />
                  </button>
                  <ul className="dropdown-menu dropdown-menu-right" aria-labelledby="dropdownKebab">
                    <li><a href="#" onClick={this.handleShowModalExport}>Export</a></li>
                  </ul>
                </div>
              </li>
            </ul>
          </div>
          <div className="cmpsr-title">
            <h1 className="cmpsr-title__item">{this.props.route.params.recipe}</h1>
            <p className="cmpsr-title__item">
              {recipe.description && <span className="text-muted">{recipe.description}</span>}
            </p>
          </div>
        </header>
        <Tabs key="pf-tabs" ref="pfTabs" tabChanged={this.handleTabChanged}>
          <Tab tabTitle="Details" active={activeTab === 'Details'}>
            <div className="tab-container row">
              <div className="col-sm-6 col-lg-4">
                <dl className="dl-horizontal mt-">
                  <dt>Name</dt>
                  <dd>{recipe.name}</dd>
                  <dt>Description</dt>
                  {(editDescriptionVisible &&
                    <dd>
                      <div className="input-group">
                        <input
                          type="text"
                          className="form-control"
                          value={editDescriptionValue}
                          onChange={this.handleChangeDescription}
                        />
                        <span className="input-group-btn">
                          <button className="btn btn-link" type="button" onClick={() => this.handleEditDescription('save')}>
                            <span className="fa fa-check" />
                          </button>
                          <button className="btn btn-link" type="button" onClick={() => this.handleEditDescription('cancel')}>
                            <span className="pficon pficon-close" />
                          </button>
                        </span>
                      </div>
                    </dd>) ||
                    <dd onClick={() => this.handleEditDescription()}>
                      {recipe.description}
                      <button className="btn btn-link" type="button">
                        <span className="pficon pficon-edit" />
                      </button>
                    </dd>}
                  <dt>Install size</dt>
                  <dd>2,678 KB</dd>
                  <dt>Last modified date</dt>
                  <dd>Thu,  9 Nov 2017</dd>
                </dl>
              </div>
              <div className="col-sm-6 col-lg-8">
                <div className="cmpsr-summary-listview">
                  <p><strong>Changes</strong> <span className="badge">{this.state.changes.length}</span></p>
                  <div className="list-pf list-pf-stacked cmpsr-list-pf__compacted cmpsr-recipe__changes">
                    {this.state.changes.map((change, i) => (
                      <ListItemChanges
                        listItem={change}
                        number={this.state.changes.length - i}
                        listItemParent="cmpsr-recipe__changes"
                        key={i}
                      />
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </Tab>
          <Tab tabTitle="Components" active={activeTab === 'Components'}>
            <div className="row">
              {(selectedComponent === '' &&
                <div className="col-sm-12">
                  <div className="row toolbar-pf">
                    <div className="col-sm-12">
                      <form className="toolbar-pf-actions">
                        <div className="form-group">
                          <div className="dropdown btn-group">
                            <button
                              type="button"
                              className="btn btn-default dropdown-toggle"
                              data-toggle="dropdown"
                              aria-haspopup="true"
                              aria-expanded="false"
                            >
                              Change 5<span className="caret" />
                            </button>
                            <ul className="dropdown-menu">
                              <li><a>Change 5</a></li>
                              <li><a>Change 4</a></li>
                              <li><a>Change 3</a></li>
                              <li><a>Change 2</a></li>
                              <li><a>Change 1</a></li>
                            </ul>
                          </div>
                        </div>
                        <div className="form-group toolbar-pf-filter">
                          <label className="sr-only" htmlFor="filter">Name</label>
                          <div className="input-group">
                            <div className="input-group-btn">
                              <button
                                type="button"
                                className="btn btn-default dropdown-toggle"
                                data-toggle="dropdown"
                                aria-haspopup="true"
                                aria-expanded="false"
                              >
                                Name<span className="caret" />
                              </button>
                              <ul className="dropdown-menu">
                                <li><a>Name</a></li>
                                <li><a>Version</a></li>
                              </ul>
                            </div>
                            <input type="text" className="form-control" id="filter" placeholder="Filter By Name..." />
                          </div>
                        </div>
                        <div className="form-group">
                          <div className="dropdown btn-group">
                            <button
                              type="button"
                              className="btn btn-default dropdown-toggle"
                              data-toggle="dropdown"
                              aria-haspopup="true"
                              aria-expanded="false"
                            >
                              Name<span className="caret" />
                            </button>
                            <ul className="dropdown-menu">
                              <li><a>Name</a></li>
                              <li><a>Version</a></li>
                            </ul>
                          </div>
                          {this.props.componentsSortKey === 'name' && this.props.componentsSortValue === 'DESC' &&
                            <button
                              className="btn btn-link"
                              type="button"
                              onClick={() => {
                                this.props.componentsSortSetValue('ASC');
                                this.props.dependenciesSortSetValue('ASC');
                              }}
                            >
                              <span className="fa fa-sort-alpha-asc" />
                            </button>
                          ||
                          this.props.componentsSortKey === 'name' && this.props.componentsSortValue === 'ASC' &&
                            <button
                              className="btn btn-link"
                              type="button"
                              onClick={() => {
                                this.props.componentsSortSetValue('DESC');
                                this.props.dependenciesSortSetValue('DESC');
                              }}
                            >
                              <span className="fa fa-sort-alpha-desc" />
                            </button>
                          }
                        </div>
                      </form>
                    </div>
                  </div>
                  {(components === undefined || components.length === 0) &&
                    <EmptyState
                      title={'Empty Recipe'}
                      message={'There are no components listed in the recipe. Edit the recipe to add components.'}
                    >
                      <Link to={`/edit/${this.props.route.params.recipe}`}>
                        <button className="btn btn-default btn-primary" type="button">
                          Edit Recipe
                        </button>
                      </Link>
                    </EmptyState> ||
                    <RecipeContents
                      components={components}
                      dependencies={dependencies}
                      noEditComponent
                      handleComponentDetails={this.handleComponentDetails}
                    />}
                </div>) ||
                <div className="col-sm-12 cmpsr-component-details--view">
                  <h3 className="cmpsr-panel__title cmpsr-panel__title--main">Component Details</h3>
                  <ComponentDetailsView
                    parent={this.props.route.params.recipe}
                    component={selectedComponent}
                    componentParent={selectedComponentParent}
                    status={selectedComponentStatus}
                    handleComponentDetails={this.handleComponentDetails}
                  />
                </div>}
            </div>
          </Tab>
          <Tab tabTitle="Compositions" active={activeTab === 'Compositions'}>
            <div className="tab-container">
              {(this.state.compositions.length === 0 &&
                <EmptyState title={'No Compositions'} message={'No compositions have been created from this recipe.'}>
                  <button
                    className="btn btn-default"
                    id="cmpsr-btn-crt-compos"
                    data-toggle="modal"
                    data-target="#cmpsr-modal-crt-compos"
                    type="button"
                  >
                    Create Composition
                  </button>
                </EmptyState>) ||
                <ListView className="cmpsr-recipe__compositions cmpsr-list">
                  {this.state.compositions.map((composition, i) => (
                    <ListItemCompositions
                      listItemParent="cmpsr-recipe__compositions"
                      recipe={this.props.route.params.recipe}
                      listItem={composition}
                      key={i}
                    />
                  ))}
                </ListView>}
            </div>
          </Tab>
        </Tabs>
        <CreateComposition recipe={recipe.name} compositionTypes={compositionTypes} setNotifications={this.setNotifications} />
        {exportModalVisible
          ? <ExportRecipe
            recipe={recipe.name}
            contents={recipe.dependencies}
            handleHideModal={this.handleHideModalExport}
          />
          : null}
      </Layout>
    );
  }
}

RecipePage.propTypes = {
  route: PropTypes.object,
  rehydrated: PropTypes.bool,
  fetchingRecipeContents: PropTypes.func,
  recipe: PropTypes.object,
  setActiveTab: PropTypes.func,
  setEditDescriptionValue: PropTypes.func,
  setEditDescriptionVisible: PropTypes.func,
  setSelectedComponent: PropTypes.func,
  setSelectedComponentParent: PropTypes.func,
  setSelectedComponentStatus: PropTypes.func,
  setModalExportRecipeVisible: PropTypes.func,
  recipePage: PropTypes.object,
  setRecipeDescription: PropTypes.func,
  exportModalVisible: PropTypes.bool,
  compositionTypes: PropTypes.array,
  dependenciesSortSetKey: PropTypes.func,
  dependenciesSortSetValue: PropTypes.func,
  componentsSortSetKey: PropTypes.func,
  componentsSortSetValue: PropTypes.func,
  components: PropTypes.array,
  dependencies: PropTypes.array,
  componentsSortKey: PropTypes.string,
  componentsSortValue: PropTypes.string,
};

const makeMapStateToProps = () => {
  const getRecipeById = makeGetRecipeById();
  const getSortedComponents = makeGetSortedComponents();
  const getSortedDependencies = makeGetSortedDependencies();
  const mapStateToProps = (state, props) => {
    if (getRecipeById(state, props.route.params.recipe.replace(/\s/g, '-')) !== undefined) {
      const fetchedRecipe = getRecipeById(state, props.route.params.recipe.replace(/\s/g, '-'));
      return {
        rehydrated: state.rehydrated,
        recipe: fetchedRecipe.present,
        components: getSortedComponents(state, fetchedRecipe.present),
        dependencies: getSortedDependencies(state, fetchedRecipe.present),
        recipePage: state.recipePage,
        exportModalVisible: state.modals.exportRecipe.visible,
        compositionTypes: state.modals.createComposition.compositionTypes,
        componentsSortKey: state.sort.components.key,
        componentsSortValue: state.sort.components.value,
      };
    }
    return {
      rehydrated: state.rehydrated,
      recipe: {},
      components: [],
      dependencies: [],
      recipePage: state.recipePage,
      exportModalVisible: state.modals.exportRecipe.visible,
      compositionTypes: state.modals.createComposition.compositionTypes,
      componentsSortKey: state.sort.components.key,
      componentsSortValue: state.sort.components.value,
    };
  };
  return mapStateToProps;
};

const mapDispatchToProps = (dispatch) => ({
  fetchingRecipeContents: recipeId => {
    dispatch(fetchingRecipeContents(recipeId));
  },
  setRecipeDescription: (recipe, description) => {
    dispatch(setRecipeDescription(recipe, description));
  },
  setEditDescriptionValue: (value) => {
    dispatch(setEditDescriptionValue(value));
  },
  setEditDescriptionVisible: (visible) => {
    dispatch(setEditDescriptionVisible(visible));
  },
  setActiveTab: (activeTab) => {
    dispatch(setActiveTab(activeTab));
  },
  setSelectedComponent: (component) => {
    dispatch(setSelectedComponent(component));
  },
  setSelectedComponentParent: (componentParent) => {
    dispatch(setSelectedComponentParent(componentParent));
  },
  setSelectedComponentStatus: (componentStatus) => {
    dispatch(setSelectedComponentStatus(componentStatus));
  },
  setModalExportRecipeVisible: (visible) => {
    dispatch(setModalExportRecipeVisible(visible));
  },
  componentsSortSetKey: key => {
    dispatch(componentsSortSetKey(key));
  },
  componentsSortSetValue: value => {
    dispatch(componentsSortSetValue(value));
  },
  dependenciesSortSetKey: key => {
    dispatch(dependenciesSortSetKey(key));
  },
  dependenciesSortSetValue: value => {
    dispatch(dependenciesSortSetValue(value));
  },
});

export default connect(makeMapStateToProps, mapDispatchToProps)(RecipePage);
