import React from 'react';
import PropTypes from 'prop-types';


class EmptyState extends React.PureComponent {

  render() {
    return (
      <div className="blank-slate-pf">
        {this.props.icon}
        <h1>{this.props.title}</h1>
        <p>{this.props.message}</p>
        {this.props.children}
      </div>
    );
  }

}

EmptyState.propTypes = {
  icon: PropTypes.string,
  title: PropTypes.string,
  message: PropTypes.string,
  children: PropTypes.node,
};

export default EmptyState;
