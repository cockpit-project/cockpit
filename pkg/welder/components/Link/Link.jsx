import React from 'react';
import PropTypes from 'prop-types';
import history from '../../core/history';

class Link extends React.Component {
  constructor() {
    super();
    this.handleClick = this.handleClick.bind(this);
  }

  handleClick (event) {
    if (this.props.onClick) {
      this.props.onClick(event);
    }

    if (event.button !== 0 /* left click */) {
      return;
    }

    if (event.metaKey || event.altKey || event.ctrlKey || event.shiftKey) {
      return;
    }

    if (event.defaultPrevented === true) {
      return;
    }

    event.preventDefault();

    if (this.props.to) {
      history.push(this.props.to);
    } else {
      history.push({
        pathname: event.currentTarget.pathname,
        search: event.currentTarget.search,
      });
    }
  }

  render() {
    var propsWithoutTo = Object.assign({}, this.props);
    delete propsWithoutTo.to;
    return (<a href={history.createHref(this.props.to)} {...propsWithoutTo} onClick={this.handleClick}>
      {this.props.children}
    </a>);
  }

}

Link.propTypes = {
  to: PropTypes.oneOfType([PropTypes.string, PropTypes.object]).isRequired,
  onClick: PropTypes.func,
  children: PropTypes.node,
};

export default Link;
