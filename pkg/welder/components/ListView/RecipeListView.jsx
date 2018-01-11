/* global $ */

import React from 'react';
import PropTypes from 'prop-types';
import Link from '../../components/Link';
import CreateComposition from '../../components/Modal/CreateComposition';

class RecipeListView extends React.Component {
  constructor() {
    super();
    this.state = { recipe: '' };
  }

  // The following enables the expand/collapse interaction
  // componentDidMount() {
  //   this.bindExpand();
  // }
  //
  // componentDidUpdate() {
  //   this.unbind();
  //   this.bindExpand();
  // }
  //
  // componentWillUnmount() {
  //   this.unbind();
  // }

  //   bindExpand() {
  //   // click the list-view heading then expand a row
  //   $('.list-group-item-header').click(function (event) {
  //     if (!$(event.target).is('button, a, input, .fa-ellipsis-v')) {
  //       $(this).find('.fa-angle-right')
  //         .toggleClass('fa-angle-down')
  //         .end()
  //         .parent()
  //         .toggleClass('list-view-pf-expand-active')
  //         .find('.list-group-item-container')
  //         .toggleClass('hidden');
  //     }
  //   });
  //
  //   // click the close button, hide the expand row and remove the active status
  //   $('.list-group-item-container .close').on('click', function () {
  //     $(this).parent()
  //       .addClass('hidden')
  //       .parent()
  //       .removeClass('list-view-pf-expand-active')
  //       .find('.fa-angle-right')
  //       .removeClass('fa-angle-down');
  //   });
  // }
  //
  // unbind() {
  //   $('.list-group-item-header').off('click');
  //   $('.list-group-item-container .close').off('click');
  // }

  handleCreateCompos(recipe) {
    this.setState({ recipe });
    $('#cmpsr-modal-crt-compos').modal('show');
  }

  render() {
    const { recipes, compositionTypes } = this.props; // eslint-disable-line no-use-before-define
    return (
      <div className="list-group list-view-pf list-view-pf-view">

        {recipes.map((recipe, i) =>
          <div className="list-group-item" key={i}>
            <div className="list-group-item-header">
              <div className="list-view-pf-expand hidden">
                <span className="fa fa-angle-right"></span>
              </div>
              <div className="list-view-pf-checkbox">
                <input type="checkbox" />
              </div>
              <div className="list-view-pf-actions">
                <Link to={`/edit/${recipe.name}`}>
                  <button className="btn btn-default" type="button">Edit Recipe</button>
                </Link>
                <button
                  className="btn btn-default"
                  onClick={() => this.handleCreateCompos(recipe.name)}
                >
                  Create Composition
                </button>
                <div className="dropdown pull-right dropdown-kebab-pf">
                  <button
                    className="btn btn-link dropdown-toggle"
                    type="button"
                    id="dropdownKebabRight9"
                    data-toggle="dropdown"
                    aria-haspopup="true"
                    aria-expanded="true"
                  ><span className="fa fa-ellipsis-v"></span></button>
                  <ul
                    className="dropdown-menu dropdown-menu-right"
                    aria-labelledby="dropdownKebabRight9"
                  >
                    <li><a href="#" onClick={(e) => this.props.handleShowModalExport(e, recipe.name)}>Export</a></li>
                    <li><a href="#" onClick={(e) => this.props.handleDelete(e, recipe.id)}>Archive</a></li>
                  </ul>
                </div>
              </div>
              <div className="list-view-pf-main-info">
                <div className="list-view-pf-left">
                  <span className="fa fa-cube list-view-pf-icon-sm"></span>
                </div>
                <div className="list-view-pf-body">
                  <div className="list-view-pf-description">
                    <div className="list-group-item-heading">
                      <Link to={`/recipe/${recipe.name}`}>{recipe.name}</Link>
                    </div>
                    <div className="list-group-item-text">
                      {recipe.description}
                    </div>
                  </div>
                  <div className="list-view-pf-additional-info hidden">
                    <div
                      className="list-view-pf-additional-info-item list-view-pf-additional-info-item-stacked hidden"
                    >
                      Test<strong>2</strong></div>
                    <div
                      className="list-view-pf-additional-info-item list-view-pf-additional-info-item-stacked hidden"
                    >
                      Development<strong>0</strong>
                    </div>
                    <div
                      className="list-view-pf-additional-info-item list-view-pf-additional-info-item-stacked hidden"
                    >
                      Production<strong>1</strong>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <div className="list-group-item-container container-fluid hidden">
              <div className="close hidden">
                <span className="pficon pficon-close"></span>
              </div>
              <div className="row">
                <div className="col-sm-12">
                  <div className="list-group list-view-pf list-view-pf-view">
                    <div className="list-group-item">

                      <div className="list-view-pf-checkbox">
                        <input type="checkbox" />
                      </div>
                      <div className="list-view-pf-actions">
                        <button className="btn btn-default">View Recipe</button>
                        <button className="btn btn-default">Download</button>
                        <div className="dropdown pull-right dropdown-kebab-pf">
                          <button
                            className="btn btn-link dropdown-toggle"
                            type="button"
                            id="dropdownKebabRight12"
                            data-toggle="dropdown"
                            aria-haspopup="true"
                            aria-expanded="true"
                          >
                            <span className="fa fa-ellipsis-v"></span>
                          </button>
                          <ul
                            className="dropdown-menu dropdown-menu-right"
                            aria-labelledby="dropdownKebabRight12"
                          >
                            <li><a >Action</a></li>
                            <li><a >Another action</a></li>
                            <li><a >Something else here</a></li>
                            <li role="separator" className="divider"></li>
                            <li><a >Separated link</a></li>
                          </ul>
                        </div>
                      </div>
                      <div className="list-view-pf-main-info">
                        <div className="list-view-pf-left">
                          <span className="fa fa-linux list-view-pf-icon-sm"></span>
                        </div>
                        <div className="list-view-pf-body">
                          <div className="list-view-pf-description">
                            <div className="list-group-item-heading">
                              Composition 1
                            </div>
                            <div className="list-group-item-text">
                              Created from Version 1
                            </div>
                          </div>
                        </div>
                      </div>

                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
      {compositionTypes !== undefined &&
        <CreateComposition
          compositionTypes={compositionTypes}
          recipe={this.state.recipe}
          setNotifications={this.props.setNotifications}
        />
      }
      </div>
    );
  }

}

RecipeListView.propTypes = {
  handleDelete: PropTypes.func,
  recipes: PropTypes.array,
  setNotifications: PropTypes.func,
  handleShowModalExport: PropTypes.func,
  compositionTypes: PropTypes.array,
};

export default RecipeListView;
