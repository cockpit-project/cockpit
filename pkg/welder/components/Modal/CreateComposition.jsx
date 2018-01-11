/* global $ */

import React from 'react';
import PropTypes from 'prop-types';
import NotificationsApi from '../../data/NotificationsApi';

class CreateComposition extends React.Component {
  constructor() {
    super();
    this.handleCreateCompos = this.handleCreateCompos.bind(this);
  }

  handleCreateCompos() {
    $('#cmpsr-modal-crt-compos').modal('hide');
    NotificationsApi.displayNotification(this.props.recipe, 'creating');
    this.props.setNotifications();
  }

  render() {
    return (
      <div
        className="modal fade"
        id="cmpsr-modal-crt-compos"
        tabIndex="-1"
        role="dialog"
        aria-labelledby="myModalLabel"
        aria-hidden="true"
      >
        <div className="modal-dialog">
          <div className="modal-content">
            <div className="modal-header">
              <button type="button" className="close" data-dismiss="modal" aria-hidden="true">
                <span className="pficon pficon-close"></span>
              </button>
              <h4 className="modal-title" id="myModalLabel">Create Composition</h4>
            </div>
            <div className="modal-body">
              <form className="form-horizontal">
                <div className="form-group">
                  <label
                    className="col-sm-3 control-label"
                  >Recipe</label>
                  <div className="col-sm-9">
                    <p className="form-control-static">{this.props.recipe}</p>
                  </div>
                </div>
                <div className="form-group">
                  <label
                    className="col-sm-3 control-label"
                    htmlFor="textInput-modal-markup"
                  >Composition Type</label>
                  <div className="col-sm-9">
                    <select className="form-control">
                      {this.props.compositionTypes !== undefined && this.props.compositionTypes.map((type, i) =>
                        <option key={i} disabled={!type.enabled}>{type.name}</option>
                      )}
                    </select>
                  </div>
                </div>
                <div className="form-group">
                  <label
                    className="col-sm-3 control-label"
                    htmlFor="textInput2-modal-markup"
                  >Architecture</label>
                  <div className="col-sm-9">
                    <select className="form-control">
                      <option>x86_64</option>
                    </select>
                  </div>
                </div>
              </form>
            </div>
            <div className="modal-footer">
              <button type="button" className="btn btn-default" data-dismiss="modal">Cancel</button>
              <button type="button" className="btn btn-primary" onClick={this.handleCreateCompos}>Create</button>
            </div>
          </div>
        </div>
      </div>
    );
  }
}

CreateComposition.propTypes = {
  recipe: PropTypes.string,
  setNotifications: PropTypes.func,
  compositionTypes: PropTypes.array,
};

export default CreateComposition;
