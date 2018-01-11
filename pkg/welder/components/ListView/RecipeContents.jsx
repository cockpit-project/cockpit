import React from 'react';
import PropTypes from 'prop-types';
import Tabs from '../../components/Tabs/Tabs';
import Tab from '../../components/Tabs/Tab';
import ListView from '../../components/ListView/ListView';
import ListItemComponents from '../../components/ListView/ListItemComponents';
import DependencyListView from '../../components/ListView/DependencyListView';

class RecipeContents extends React.Component {
  constructor() {
    super();
    this.state = { activeTab: 'Components' };
    this.handleTabChanged = this.handleTabChanged.bind(this);
  }

  handleTabChanged(e) {
    if (this.state.activeTab !== e.detail) {
      this.setState({ activeTab: e.detail });
    }
    e.preventDefault();
    e.stopPropagation();
  }

  render() {
    const { components, dependencies, handleComponentDetails, handleRemoveComponent, noEditComponent } = this.props;

    return (
      <div>
        <Tabs
          key={components.length + dependencies.length}
          ref={c => {
            this.pfTabs = c;
          }}
          tabChanged={this.handleTabChanged}
          classnames="nav nav-tabs nav-tabs-pf"
        >
          <Tab
            tabTitle={`Selected Components <span class="badge">${components.length}</span>`}
            active={this.state.activeTab === 'Selected'}
          >
            <ListView className="cmpsr-recipe__components" stacked>
              {components.map((listItem, i) => (
                <ListItemComponents
                  listItemParent="cmpsr-recipe__components"
                  listItem={listItem}
                  key={i}
                  handleRemoveComponent={handleRemoveComponent}
                  handleComponentDetails={handleComponentDetails}
                  noEditComponent={noEditComponent}
                />
              ))}
            </ListView>
          </Tab>
          <Tab
            tabTitle={`Dependencies <span class="badge">${dependencies.length}</span>`}
            active={this.state.activeTab === 'Dependencies'}
          >
            <DependencyListView
              className="cmpsr-recipe__dependencies"
              listItems={dependencies}
              handleRemoveComponent={handleRemoveComponent}
              handleComponentDetails={handleComponentDetails}
              noEditComponent={noEditComponent}
            />
          </Tab>
        </Tabs>
      </div>
    );
  }
}

RecipeContents.propTypes = {
  components: PropTypes.array,
  dependencies: PropTypes.array,
  handleComponentDetails: PropTypes.func,
  handleRemoveComponent: PropTypes.func,
  noEditComponent: PropTypes.bool,
};

export default RecipeContents;
