import React from 'react';
import PropTypes from 'prop-types';

class ListItemCompositions extends React.PureComponent {
  render() {
    const { listItem } = this.props;

    return (
      <div className="list-pf-item">
        <div className="list-pf-container">
          <div className="list-pf-content list-pf-content-flex">
            <div className="list-pf-left">
              <span className="pf pficon-image list-pf-icon-small" aria-hidden="true" />
            </div>
            <div className="list-pf-content-wrapper">
              <div className="list-pf-main-content">
                <div className="list-pf-title text-overflow-pf">
                  <a href="#">{this.props.recipe}-rev{listItem.change}-{listItem.type}</a>
                </div>
                <div className="list-pf-description">Based on change {listItem.change}</div>
              </div>
              <div className="list-pf-additional-content">
                <div className="list-view-pf-additional-info-item list-view-pf-additional-info-item-stacked">
                  Type <strong>{listItem.type}</strong>
                </div>
                <div className="list-view-pf-additional-info-item list-view-pf-additional-info-item-stacked">
                  Date Created <strong>{listItem.date_created}</strong>
                </div>
                <div className="list-view-pf-additional-info-item list-view-pf-additional-info-item-stacked">
                  Install Size <strong>{listItem.size}</strong>
                </div>
              </div>
            </div>
            <div className="list-pf-actions">
              <button className="btn btn-default" type="button">Download</button>
              <div className="dropdown pull-right dropdown-kebab-pf">
                <button
                  className="btn btn-link dropdown-toggle"
                  type="button"
                  id="dropdownKebabRight9"
                  data-toggle="dropdown"
                  aria-haspopup="true"
                  aria-expanded="true"
                >
                  <span className="fa fa-ellipsis-v" />
                </button>
                <ul className="dropdown-menu dropdown-menu-right" aria-labelledby="dropdownKebabRight9">
                  <li><a>View Recipe Components</a></li>
                  <li><a>View Recipe Manifest</a></li>
                  <li><a>Export</a></li>
                  <li role="separator" className="divider" />
                  <li><a>Archive</a></li>
                </ul>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }
}

ListItemCompositions.propTypes = {
  listItem: PropTypes.object,
};

export default ListItemCompositions;
