import React from 'react';
import PropTypes from 'prop-types';
import ComponentTypeIcons from '../../components/ListView/ComponentTypeIcons';

class ComponentSummaryList extends React.Component {
  constructor() {
    super();
    this.state = { showAll: false };
  }

  handleShowAll(event) {
    // the user clicked a list item in the recipe contents area to expand or collapse
    const showState = !this.state.showAll;
    this.setState({ showAll: showState });
    event.preventDefault();
    event.stopPropagation();
  }

  render() {
    const listItems = this.state.showAll ? this.props.listItems : this.props.listItems.slice(0, 5);
    return (
      <div className="cmpsr-summary-listview">
        <p>
          <strong>Dependencies</strong>
          <span className="badge">{this.props.listItems.length}</span>
          <a href="#" className="pull-right" onClick={e => this.handleShowAll(e)}>
            {`${this.state.showAll ? 'Show Less' : 'Show All'}`}
          </a>
        </p>
        <div className="list-pf cmpsr-list-pf__compacted">
          {listItems.map((listItem, i) => (
            <div className="list-pf-item" key={i}>
              <div className="list-pf-container">
                <div className="list-pf-content list-pf-content-flex ">
                  <div className="list-pf-left">
                    <ComponentTypeIcons
                      componentType={listItem.ui_type}
                      componentInRecipe
                      isDependency={this.props.isDependency}
                    />
                  </div>
                  <div className="list-pf-content-wrapper">
                    <div className="list-pf-main-content">
                      <div className="list-pf-description ">
                        <a>{listItem.name}</a>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }
}

ComponentSummaryList.propTypes = {
  listItems: PropTypes.array,
  isDependency: PropTypes.bool,
};

export default ComponentSummaryList;
