/* global $ */

import React from 'react';
import PropTypes from 'prop-types';
import RecipeApi from '../../data/RecipeApi';
import { connect } from 'react-redux';
import {
  setModalCreateRecipeErrorNameVisible, setModalCreateRecipeErrorDuplicateVisible,
  setModalCreateRecipeErrorInline, setModalCreateRecipeCheckErrors, setModalCreateRecipeRecipe,
} from '../../core/actions/modals';
import { creatingRecipeSucceeded } from '../../core/actions/recipes';

class CreateRecipe extends React.Component {

  componentDidMount() {
    this.bindAutofocus();
  }

  componentDidUpdate() {
    this.unbind();
    this.bindAutofocus();
  }

  componentWillUnmount() {
    const initialRecipe = {
      name: '',
      description: '',
      modules: [],
      packages: [],
    };
    this.props.setModalCreateRecipeRecipe(initialRecipe);
    this.unbind();
  }

  bindAutofocus() {
    $('#cmpsr-modal-crt-recipe').on('shown.bs.modal', () => {
      $('#textInput-modal-markup').focus();
    });
  }

  unbind() {
    $('#cmpsr-modal-crt-compos .btn-primary').off('shown.bs.modal');
  }

  handleChange(e, prop) {
    const o = Object.assign({}, this.props.createRecipe.recipe);
    o[prop] = e.target.value;
    this.props.setModalCreateRecipeRecipe(o);
    if (prop === 'name') {
      this.dismissErrors();
      this.handleErrorDuplicate(e.target.value);
    }
  }

  handleEnterKey(event) {
    if (event.which === 13 || event.keyCode === 13) {
      this.handleErrors(this.props.createRecipe.recipe.name);
      setTimeout(() => {
        if (this.props.createRecipe.errorNameVisible || this.props.createRecipe.errorDuplicateVisible) {
          this.showInlineError();
        } else {
          this.handleCreateRecipe(event, this.props.createRecipe.recipe);
        }
      }, 300);
    }
  }

  handleCreateRecipe(event, recipe) {
    $('#cmpsr-modal-crt-recipe').modal('hide');
    RecipeApi.handleCreateRecipe(event, recipe);
    const updatedRecipe = recipe;
    updatedRecipe.id = updatedRecipe.name.replace(/\s/g, '-');
    this.props.creatingRecipeSucceeded(updatedRecipe);
  }

  errorChecking(state) {
    this.props.setModalCreateRecipeCheckErrors(state);
  }

  dismissErrors() {
    this.props.setModalCreateRecipeErrorInline(false);
    this.props.setModalCreateRecipeErrorNameVisible(false);
    this.props.setModalCreateRecipeErrorDuplicateVisible(false);
  }

  handleErrors(recipeName) {
    this.handleErrorDuplicate(recipeName);
    this.handleErrorName(recipeName);
  }

  handleErrorDuplicate(recipeName) {
    const nameNoSpaces = recipeName.replace(/\s+/g, '-');
    if (this.props.recipeNames.includes(nameNoSpaces)) {
      this.props.setModalCreateRecipeErrorDuplicateVisible(true);
    }
  }

  handleErrorName(recipeName) {
    if (recipeName === '' && this.props.createRecipe.checkErrors) {
      setTimeout(() => {
        this.props.setModalCreateRecipeErrorNameVisible(true);
      }, 200);
    }
  }

  showInlineError() {
    this.props.setModalCreateRecipeErrorInline(true);
  }

  render() {
    const { createRecipe } = this.props;
    return (
      <div
        className="modal fade"
        id="cmpsr-modal-crt-recipe"
        tabIndex="-1"
        role="dialog"
        aria-labelledby="myModalLabel"
        aria-hidden="true"
      >
        <div className="modal-dialog">
          <div className="modal-content">
            <div className="modal-header">
              <button
                type="button"
                className="close"
                data-dismiss="modal"
                aria-hidden="true"
                onMouseEnter={() => this.errorChecking(false)}
                onMouseLeave={() => this.errorChecking(true)}
                onClick={(e) => this.dismissErrors(e)}
              >
                <span className="pficon pficon-close"></span>
              </button>
              <h4 className="modal-title" id="myModalLabel">Create Recipe</h4>
            </div>
            <div className="modal-body">
              {(createRecipe.errorInline && createRecipe.errorNameVisible) &&
                <div className="alert alert-danger">
                  <span className="pficon pficon-error-circle-o"></span>
                  <strong>Required information is missing.</strong>
                </div>
              }
              {(createRecipe.errorInline && createRecipe.errorDuplicateVisible) &&
                <div className="alert alert-danger">
                  <span className="pficon pficon-error-circle-o"></span>
                  <strong>Specify a new recipe name.</strong>
                </div>
              }
              <form className="form-horizontal" onKeyPress={(e) => this.handleEnterKey(e)}>
                <p className="fields-status-pf">
                  The fields marked with <span className="required-pf">*</span> are required.
                </p>
                <div
                  className={`form-group ${(createRecipe.errorNameVisible || createRecipe.errorDuplicateVisible)
                    ? 'has-error' : ''}`}
                >
                  <label
                    className="col-sm-3 control-label required-pf"
                    htmlFor="textInput-modal-markup"
                  >Name</label>
                  <div className="col-sm-9">
                    <input
                      type="text"
                      id="textInput-modal-markup"
                      className="form-control"
                      value={createRecipe.recipe.name}
                      onFocus={(e) => { this.dismissErrors(); this.handleErrorDuplicate(e.target.value); }}
                      onChange={(e) => this.handleChange(e, 'name')}
                      onBlur={(e) => this.handleErrors(e.target.value)}
                    />
                    {createRecipe.errorNameVisible &&
                      <span className="help-block">A recipe name is required.</span>
                    }
                    {createRecipe.errorDuplicateVisible &&
                      <span className="help-block">The name "{createRecipe.recipe.name}" already exists.</span>
                    }
                  </div>
                </div>
                <div className="form-group">
                  <label
                    className="col-sm-3 control-label"
                    htmlFor="textInput2-modal-markup"
                  >Description</label>
                  <div className="col-sm-9">
                    <input
                      type="text"
                      id="textInput2-modal-markup"
                      className="form-control"
                      value={createRecipe.recipe.description}
                      onChange={(e) => this.handleChange(e, 'description')}
                    />
                  </div>
                </div>
              </form>
            </div>
            <div className="modal-footer">
              <button
                type="button"
                className="btn btn-default"
                data-dismiss="modal"
                onMouseEnter={() => this.errorChecking(false)}
                onMouseLeave={() => this.errorChecking(true)}
                onClick={(e) => this.dismissErrors(e)}
              >Cancel</button>
              {(createRecipe.recipe.name === '' || createRecipe.errorDuplicateVisible) &&
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={(e) => this.showInlineError(e)}
                >Save</button>
                ||
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={(e) => { this.handleCreateRecipe(e, createRecipe.recipe); }}
                >Save</button>
              }
            </div>
          </div>
        </div>
      </div>
    );
  }
}

CreateRecipe.propTypes = {
  recipeNames: PropTypes.array,
  setModalCreateRecipeErrorNameVisible: PropTypes.func,
  setModalCreateRecipeErrorDuplicateVisible: PropTypes.func,
  setModalCreateRecipeErrorInline: PropTypes.func,
  setModalCreateRecipeCheckErrors: PropTypes.func,
  setModalCreateRecipeRecipe: PropTypes.func,
  createRecipe: PropTypes.object,
  creatingRecipeSucceeded: PropTypes.func,
};

const mapStateToProps = state => ({
  createRecipe: state.modals.createRecipe,
});


const mapDispatchToProps = dispatch => ({
  setModalCreateRecipeErrorNameVisible: nameErrorVisible => {
    dispatch(setModalCreateRecipeErrorNameVisible(nameErrorVisible));
  },
  setModalCreateRecipeErrorDuplicateVisible: duplicateErrorVisible => {
    dispatch(setModalCreateRecipeErrorDuplicateVisible(duplicateErrorVisible));
  },
  setModalCreateRecipeErrorInline: inlineError => {
    dispatch(setModalCreateRecipeErrorInline(inlineError));
  },
  setModalCreateRecipeCheckErrors: checkErrors => {
    dispatch(setModalCreateRecipeCheckErrors(checkErrors));
  },
  setModalCreateRecipeRecipe: recipe => {
    dispatch(setModalCreateRecipeRecipe(recipe));
  },
  creatingRecipeSucceeded: (recipe) => {
    dispatch(creatingRecipeSucceeded(recipe));
  },
});

export default connect(mapStateToProps, mapDispatchToProps)(CreateRecipe);
