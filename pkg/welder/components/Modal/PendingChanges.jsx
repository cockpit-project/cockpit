/* global $ */

import React from 'react';
import PropTypes from 'prop-types';
import { connect } from 'react-redux';
import { setRecipeComment } from '../../core/actions/recipes';

class PendingChanges extends React.Component {
  constructor() {
    super();
    this.state = {
      comment: ""
    };
    this.handleChange = this.handleChange.bind(this);
    this.handleSaveChanges = this.handleSaveChanges.bind(this);
  }

  componentWillMount() {
    this.setState({comment: this.props.recipe.comment});
  }

  componentDidMount() {
    $(this.modal).modal('show');
    $(this.modal).on('hidden.bs.modal', this.props.handleHideModal);
  }

  handleSaveChanges() {
    $('#cmpsr-modal-pending-changes').modal('hide');
    this.props.handleSave();
  }

  handleChange(e) {
    this.setState({comment: e.target.value});
  }

  render() {
    return (
      <div
        className="modal fade"
        id="cmpsr-modal-pending-changes"
        ref={(c) => { this.modal = c; }}
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
              >
                <span className="pficon pficon-close"></span>
              </button>
              <h4 className="modal-title" id="myModalLabel">Changes Pending Save</h4>
            </div>
            <div className="modal-body">
              <form className="form-horizontal">
                <div className="form-group">
                  <label
                    className="col-sm-3 control-label"
                  >Recipe</label>
                  <div className="col-sm-9">
                    <p className="form-control-static">{this.props.recipe.name}</p>
                  </div>
                </div>
                <div className="form-group">
                  <label
                    className="col-sm-3 control-label"
                    htmlFor="textInput-modal-markup"
                  >Comment</label>
                  <div className="col-sm-9">
                    <textarea
                      id="textInput-modal-markup"
                      className="form-control"
                      rows="1"
                      value={this.state.comment}
                      onChange={(e) => this.handleChange(e)}
                      onBlur={() => this.props.setRecipeComment(this.props.recipe, this.state.comment)}
                    />
                  </div>
                </div>
                <div className="alert alert-info">
                  <span className="pficon pficon-info"></span>
                  Only changes to selected components are shown. <a href="#" className="alert-link">View all changes.</a>
                </div>
                <strong>Pending Changes</strong><span className="text-muted"> (most recent first)</span>
                <ul className="list-group">
                  {this.props.recipe.pendingChanges.map((componentUpdated, index) => (
                    <li className="list-group-item" key={index}>
                      {componentUpdated.componentNew && componentUpdated.componentOld &&
                        <div className="row">
                          <div className="col-sm-3">Updated</div>
                          <div className="col-sm-9">from <strong>{componentUpdated.componentOld}</strong> to <strong>
                            {componentUpdated.componentNew}</strong></div>
                        </div>
                      } {componentUpdated.componentNew && !componentUpdated.componentOld &&
                        <div className="row">
                          <div className="col-sm-3">Added</div>
                          <div className="col-sm-9"><strong>{componentUpdated.componentNew}</strong></div>
                        </div>
                      } {componentUpdated.componentOld && !componentUpdated.componentNew &&
                        <div className="row">
                          <div className="col-sm-3">Removed</div>
                          <div className="col-sm-9"><strong>{componentUpdated.componentOld}</strong></div>
                        </div>
                      }
                    </li>
                  ))}
                </ul>
              </form>
            </div>
            <div className="modal-footer">
              <button
                type="button"
                className="btn btn-default"
                data-dismiss="modal"
              >Close</button>
              <button type="button" className="btn btn-primary" onClick={() => this.handleSaveChanges()}>Save</button>
            </div>
          </div>
        </div>
      </div>
    );
  }
}

PendingChanges.propTypes = {
  comment: PropTypes.string,
  recipe: PropTypes.object,
  contents: PropTypes.array,
  handleHideModal: PropTypes.func,
  setRecipeComment: PropTypes.func,
  handleSave: PropTypes.func,
  modals: PropTypes.object,
};
const mapStateToProps = state => ({
  modals: state.modals,
});

const mapDispatchToProps = (dispatch) => ({
  setRecipeComment: (recipe, comment) => {
    dispatch(setRecipeComment(recipe, comment));
  },
});

export default connect(mapStateToProps, mapDispatchToProps)(PendingChanges);
