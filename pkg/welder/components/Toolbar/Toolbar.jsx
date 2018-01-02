import React from 'react';
import PropTypes from 'prop-types';

const Toolbar = props => (
  <div className="toolbar-pf">
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
        {props.componentsSortKey === 'name' && props.componentsSortValue === 'DESC' &&
          <button
            className="btn btn-link"
            type="button"
            onClick={() => {
              props.componentsSortSetValue('ASC');
              props.dependenciesSortSetValue('ASC');
            }}
          >
            <span className="fa fa-sort-alpha-asc" />
          </button>
        ||
        props.componentsSortKey === 'name' && props.componentsSortValue === 'ASC' &&
          <button
            className="btn btn-link"
            type="button"
            onClick={() => {
              props.componentsSortSetValue('DESC');
              props.dependenciesSortSetValue('DESC');
            }}
          >
            <span className="fa fa-sort-alpha-desc" />
          </button>
        }
      </div>
      <div className="form-group">
      {props.pastLength > 0 &&
        <button className="btn btn-link" type="button" onClick={() => {props.undo(props.recipeId); props.handleHistory();}}>
          <span className="fa fa-undo" aria-hidden="true" />
        </button>
      ||
        <button
          className="btn btn-link disabled"
          type="button"
          onClick={() => {props.undo(props.recipeId); props.handleHistory();}}
        >
          <span className="fa fa-undo" aria-hidden="true" />
        </button>
      }
      {props.futureLength > 0 &&
        <button className="btn btn-link" type="button" onClick={() => {props.redo(props.recipeId); props.handleHistory();}}>
          <span className="fa fa-repeat" aria-hidden="true" />
        </button>
      ||
        <button
          className="btn btn-link disabled"
          type="button"
          onClick={() => {props.redo(props.recipeId); props.handleHistory();}}
        >
          <span className="fa fa-repeat" aria-hidden="true" />
        </button>
      }
      </div>
      <div className="toolbar-pf-action-right">
        <div className="form-group">
          <button
            className="btn btn-default"
            id="cmpsr-btn-crt-compos"
            data-toggle="modal"
            data-target="#cmpsr-modal-crt-compos"
            type="button"
          >
            Create Composition
          </button>
          <div className="dropdown btn-group  dropdown-kebab-pf">
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
              <li><a href="#" onClick={e => props.handleShowModal(e, 'modalExportRecipe')}>Export</a></li>
              <li role="separator" className="divider" />
              <li><a>Update Selected Components</a></li>
              <li><a>Remove Selected Components</a></li>
            </ul>
          </div>
        </div>
        <div className="form-group toolbar-pf-find">
          <button className="btn btn-link btn-find" type="button">
            <span className="fa fa-search" />
          </button>
          <div className="find-pf-dropdown-container">
            <input type="text" className="form-control" id="find" placeholder="Find By Keyword..." />
            <div className="find-pf-buttons">
              <span className="find-pf-nums">1 of 3</span>
              <button className="btn btn-link" type="button">
                <span className="fa fa-angle-up" />
              </button>
              <button className="btn btn-link" type="button">
                <span className="fa fa-angle-down" />
              </button>
              <button className="btn btn-link btn-find-close" type="button">
                <span className="pficon pficon-close" />
              </button>
            </div>
          </div>
        </div>
      </div>
    </form>
  </div>
);

Toolbar.propTypes = {
  handleShowModal: PropTypes.func,
};

export default Toolbar;
