/* global $ */

import React from 'react';
import PropTypes from 'prop-types';
import ComponentTypeIcons from '../../components/ListView/ComponentTypeIcons';

class ComponentInputs extends React.Component {
  componentDidMount() {
    this.initializeBootstrapElements();
    this.bindTooltipShow();
    this.bindHideTooltip();
    this.bindTooltipMouseleave();
  }

  componentDidUpdate() {
    this.unbind();
    this.initializeBootstrapElements();
    this.bindTooltipShow();
    this.bindHideTooltip();
    this.bindTooltipMouseleave();
    this.hideTooltip('all');
  }

  componentWillUnmount() {
    this.unbind();
    this.hideTooltip('all');
  }

  bindTooltipShow() {
    $('.cmpsr-list-inputs').off().on('mouseenter focus', '[data-toggle="tooltip"]', event => {
      // prevent li tooltip from flashing when focus moves to the <a>
      event.stopPropagation();
      // hide tooltip for other list items
      if ($(event.currentTarget).hasClass('list-pf-container')) {
        $('.list-pf-container[data-toggle="tooltip"]').not(event.target).tooltip('hide');
      }
      // hide tooltip for component list item if hovering over an action
      if ($(event.currentTarget).parent('.list-pf-actions').length) {
        this.hideTooltip('parent');
      }
      $(event.currentTarget).tooltip('show');
    });
  }

  bindHideTooltip() {
    $('.cmpsr-list-inputs').on('blur mousedown', '[data-toggle="tooltip"]', event => {
      // prevent focus event so that tooltip doesn't display again on click
      event.preventDefault();
      this.hideTooltip(event.currentTarget);
    });
  }

  bindTooltipMouseleave() {
    $('.cmpsr-list-inputs').on('mouseleave', '[data-toggle="tooltip"]', event => {
      this.hideTooltip(event.currentTarget);
      if ($(event.currentTarget).parent('.list-pf-actions').length) {
        $(event.currentTarget).parents('.list-pf-container').tooltip('show');
      }
    });
  }

  unbind() {
    $('.list-pf-actions').off('mouseenter focus mouseleave blur mousedown');
  }

  hideTooltip(target) {
    if (target === 'all') {
      $('.cmpsr-list-inputs [data-toggle="tooltip"][aria-describedby]').tooltip('hide');
    } else if (target === 'parent') {
      $('.list-pf-container[data-toggle="tooltip"][aria-describedby]').tooltip('hide');
    } else {
      $(target).tooltip('hide');
    }
  }

  initializeBootstrapElements() {
    // Initialize Boostrap-tooltip
    $('[data-toggle="tooltip"]').tooltip({
      trigger: 'manual',
    });
  }

  render() {
    const { components } = this.props;

    return (
      <div className="list-pf cmpsr-list-inputs cmpsr-list-pf__compacted list-pf-stacked">
        {components.map((component, i) => (
          <div key={i} className={`list-pf-item ${component.active ? 'active' : ''}`}>
            <div
              className="list-pf-container"
              tabIndex="0"
              data-toggle="tooltip"
              data-trigger="manual"
              data-placement="top"
              title=""
              data-original-title={component.active ? 'Hide Details' : 'Show Details and More Options'}
              onClick={e => this.props.handleComponentDetails(e, component)}
            >
              <div className="list-pf-content list-pf-content-flex ">
                <div className="list-pf-left">
                  <ComponentTypeIcons componentType={component.ui_type} componentInRecipe={component.inRecipe} />
                </div>
                <div className="list-pf-content-wrapper">
                  <div className="list-pf-main-content">
                    <div className="list-pf-title ">{component.name}</div>
                    <div className="list-pf-description ">{component.summary}</div>
                  </div>
                </div>
                <div className="list-pf-actions">
                  {(component.inRecipe === true &&
                    <a
                      href="#"
                      className="btn btn-link"
                      data-toggle="tooltip"
                      data-trigger="manual"
                      data-html="true"
                      data-placement="top"
                      title=""
                      data-original-title="Remove Component from Recipe"
                      onClick={e => this.props.handleRemoveComponent(e, component)}
                    >
                      <span className="fa fa-minus" />
                    </a>) ||
                    <a
                      href="#"
                      className="btn btn-link"
                      data-toggle="tooltip"
                      data-trigger="manual"
                      data-html="true"
                      data-placement="top"
                      title=""
                      data-original-title={`Add Component<br />
                            Version&nbsp;<strong>${component.version}</strong>
                            Release&nbsp;<strong>${component.release}</strong>`}
                      onClick={e => this.props.handleAddComponent(e, 'input', component, [])}
                    >
                      <span className="fa fa-plus" />
                    </a>}
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>
    );
  }
}

ComponentInputs.propTypes = {
  components: PropTypes.array,
  handleComponentDetails: PropTypes.func,
  handleAddComponent: PropTypes.func,
  handleRemoveComponent: PropTypes.func,
};

export default ComponentInputs;
