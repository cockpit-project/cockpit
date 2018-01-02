import React from 'react';
import PropTypes from 'prop-types';
import Layout from '../../components/Layout';
import RecipeListView from '../../components/ListView/RecipeListView';
import CreateRecipe from '../../components/Modal/CreateRecipe';
import ExportRecipe from '../../components/Modal/ExportRecipe';
import EmptyState from '../../components/EmptyState/EmptyState';
import { connect } from 'react-redux';
import { fetchingRecipes, deletingRecipe } from '../../core/actions/recipes';
import {
  setModalExportRecipeName, setModalExportRecipeContents, setModalExportRecipeVisible, fetchingModalExportRecipeContents,
} from '../../core/actions/modals';
import { recipesSortSetKey, recipesSortSetValue } from '../../core/actions/sort';
import { makeGetSortedRecipes } from '../../core/selectors';

class RecipesPage extends React.Component {
  constructor() {
    super();
    this.setNotifications = this.setNotifications.bind(this);
    this.handleDelete = this.handleDelete.bind(this);
    this.handleHideModalExport = this.handleHideModalExport.bind(this);
    this.handleShowModalExport = this.handleShowModalExport.bind(this);
  }

  componentWillMount() {
  }

  componentDidMount() {
    document.title = 'Recipes';
  }

  setNotifications() {
    this.refs.layout.setNotifications();
  }

  handleDelete(event, recipe) {
    event.preventDefault();
    event.stopPropagation();
    this.props.deletingRecipe(recipe);
  }

  // handle show/hide of modal dialogs
  handleHideModalExport() {
    this.props.setModalExportRecipeVisible(false);
    this.props.setModalExportRecipeName('');
    this.props.setModalExportRecipeContents([]);
  }

  handleShowModalExport(e, recipe) {
    // This implementation of the dialog only provides a text option, and it's
    // automatically selected. Eventually, the following code should move to a
    // separate function that is called when the user selects the text option

    // display the dialog, a spinner will display while contents are undefined
    this.props.setModalExportRecipeName(recipe);
    this.props.setModalExportRecipeContents(undefined);
    const recipeName = recipe.replace(/\s/g, '-');
    // run depsolving against recipe to get contents for dialog
    this.props.fetchingModalExportRecipeContents(recipeName);
    this.props.setModalExportRecipeVisible(true);
    e.preventDefault();
    e.stopPropagation();
  }

  render() {
    const { recipes, exportRecipe, createComposition, recipeSortKey, recipeSortValue } = this.props;
    return (
      <Layout className="container-fluid" ref="layout">
        <div className="row toolbar-pf">
          <div className="col-sm-12">
            <form className="toolbar-pf-actions">
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
              {recipeSortKey === 'name' && recipeSortValue === 'DESC' &&
                <button className="btn btn-link" type="button" onClick={() => this.props.recipesSortSetValue('ASC')}>
                  <span className="fa fa-sort-alpha-asc" />
                </button>
              ||
              recipeSortKey === 'name' && recipeSortValue === 'ASC' &&
                <button className="btn btn-link" type="button" onClick={() => this.props.recipesSortSetValue('DESC')}>
                  <span className="fa fa-sort-alpha-desc" />
                </button>
              }
              </div>
              <div className="toolbar-pf-action-right">
                <div className="form-group">
                  <button className="btn btn-default" type="button" data-toggle="modal" data-target="#cmpsr-modal-crt-recipe">
                    Create Recipe
                  </button>
                </div>
              </div>
            </form>
          </div>
        </div>
      {recipes.length === 0 &&
        <EmptyState
          title="No Recipes"
          message={`Create a recipe to define the contents that will be included
            in the images you create. Images can be produced in a variety of
            output formats.`}
        >
          <button
            className="btn btn-primary btn-lg"
            type="button"
            data-toggle="modal"
            data-target="#cmpsr-modal-crt-recipe"
          >
            Create Recipe
          </button>
        </EmptyState>
      }
      {createComposition.compositionTypes !== undefined &&
        <RecipeListView
          recipes={recipes.map(recipe => recipe.present)}
          compositionTypes={createComposition.compositionTypes}
          handleDelete={this.handleDelete}
          setNotifications={this.setNotifications}
          handleShowModalExport={this.handleShowModalExport}
        />
      }
        <CreateRecipe recipeNames={recipes.map(recipe => recipe.present.id)} />
        {(exportRecipe !== undefined && exportRecipe.visible)
          ? <ExportRecipe
            recipe={exportRecipe.name}
            contents={exportRecipe.contents}
            handleHideModal={this.handleHideModalExport}
          />
          : null}
      </Layout>
    );
  }
}

RecipesPage.propTypes = {
  fetchingRecipes: PropTypes.func,
  deletingRecipe: PropTypes.func,
  setModalExportRecipeVisible: PropTypes.func,
  setModalExportRecipeName: PropTypes.func,
  setModalExportRecipeContents: PropTypes.func,
  fetchingModalExportRecipeContents: PropTypes.func,
  recipes: PropTypes.array,
  exportRecipe: PropTypes.object,
  createComposition: PropTypes.object,
  recipeSortKey: PropTypes.string,
  recipeSortValue: PropTypes.string,
  recipesSortSetKey: PropTypes.func,
  recipesSortSetValue: PropTypes.func,
};

const makeMapStateToProps = () => {
  const getSortedRecipes = makeGetSortedRecipes();
  const mapStateToProps = (state) => {
    if (getSortedRecipes(state) !== undefined) {
      return {
        exportRecipe: state.modals.exportRecipe,
        createComposition: state.modals.createComposition,
        recipes: getSortedRecipes(state),
        recipeSortKey: state.sort.recipes.key,
        recipeSortValue: state.sort.recipes.value,
      };
    }
    return {
      exportRecipe: state.modals.exportRecipe,
      createComposition: state.modals.createComposition,
      recipes: {},
      recipeSortKey: state.sort.recipes.key,
      recipeSortValue: state.sort.recipes.value,
    };
  };

  return mapStateToProps;
};


const mapDispatchToProps = dispatch => ({
  fetchingModalExportRecipeContents: modalRecipeName => {
    dispatch(fetchingModalExportRecipeContents(modalRecipeName));
  },
  fetchingRecipes: () => {
    dispatch(fetchingRecipes());
  },
  setModalExportRecipeName: modalRecipeName => {
    dispatch(setModalExportRecipeName(modalRecipeName));
  },
  setModalExportRecipeContents: modalRecipeContents => {
    dispatch(setModalExportRecipeContents(modalRecipeContents));
  },
  setModalExportRecipeVisible: modalVisible => {
    dispatch(setModalExportRecipeVisible(modalVisible));
  },
  deletingRecipe: recipe => {
    dispatch(deletingRecipe(recipe));
  },
  recipesSortSetKey: key => {
    dispatch(recipesSortSetKey(key));
  },
  recipesSortSetValue: value => {
    dispatch(recipesSortSetValue(value));
  },
});

export default connect(makeMapStateToProps, mapDispatchToProps)(RecipesPage);
