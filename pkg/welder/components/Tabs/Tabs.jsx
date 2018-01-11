import React from 'react';
import PropTypes from 'prop-types';
import './pf-tabs.component';

/**
 * React <b>Tabs</b> Component for Patternfly Web Components
 *
 * @example {@lang xml}
 * <Tabs tabChanged={ this.tabChanged(e) }>
 *  <Tab tabTitle={"Tab1"} active={true}>
 *    <p>Tab1 content here</p>
 *  </Tab>
 *  <Tab tabTitle={"Tab2"}>
 *    <p>Tab2 content here</p>
 *  </Tab>
 * </Tabs>
 *
 */
class Tabs extends React.Component {
  componentDidUpdate() {
    this.refs.pfTabs.addEventListener('tabChanged', e => {
      if (this.props.tabChanged) {
        this.props.tabChanged(e);
      }
    });
  }

  render() {
    return (
      <pf-tabs data-classname={this.props.classnames} key="pf-tabs" ref="pfTabs">
        {this.props.children}
      </pf-tabs>
    );
  }
}

Tabs.propTypes = {
  tabChanged: PropTypes.func,
  classnames: PropTypes.string,
  children: PropTypes.node,
};

export default Tabs;
