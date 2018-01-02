/* global $ */

import React from 'react';
import PropTypes from 'prop-types';

class ExportRecipe extends React.Component {

  componentDidMount() {
    $(this.modal).modal('show');
    $(this.modal).on('hidden.bs.modal', this.props.handleHideModal);
  }

  handleCopy() {
    this.recipe_contents_text.select();
    document.execCommand('copy');
  }

  render() {
    return (
      <div
        className="modal fade"
        id="cmpsr-modal-export"
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
              <h4 className="modal-title" id="myModalLabel">Export Recipe</h4>
            </div>
            <div className="modal-body">
              <form className="form-horizontal" onKeyPress={(e) => this.handleEnterKey(e)}>
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
                  >Export as</label>
                  <div className="col-sm-9">
                    <select className="form-control">
                      <option>Text</option>
                    </select>
                  </div>
                </div>
                <div className="form-group">
                  <label
                    className="col-sm-3 control-label"
                    htmlFor="textInput2-modal-markup"
                  >Contents</label>
                  {this.props.contents &&
                    <div className="col-sm-9">
                      <textarea
                        readOnly
                        id="textInput2-modal-markup"
                        ref={(c) => { this.recipe_contents_text = c; }}
                        className="form-control"
                        rows="10"
                        value={this.props.contents.map((comp) => (
                          `${comp.name}-${comp.version}-${comp.release}`
                        )).join('\n')}
                      />
                      <p>{this.props.contents.length} total components</p>
                    </div>
                    ||
                    <div className="col-sm-1">
                      <div className="spinner"></div>
                    </div>
                  }
                </div>
              </form>
            </div>
            <div className="modal-footer">
              <button
                type="button"
                className="btn btn-default"
                data-dismiss="modal"
              >Close</button>
              <button type="button" className="btn btn-primary" onClick={() => this.handleCopy()}>Copy</button>
            </div>
          </div>
        </div>
      </div>
    );
  }
}

ExportRecipe.propTypes = {
  recipe: PropTypes.string,
  contents: PropTypes.array,
  handleHideModal: PropTypes.func,
};

export default ExportRecipe;
