/*!
 * react-lite.js v0.15.6
 * (c) 2016 Jade Gu
 * Released under the MIT License.
 */
(function (global, factory) {
  typeof exports === 'object' && typeof module !== 'undefined' ? module.exports = factory() :
  typeof define === 'function' && define.amd ? define(factory) :
  global.React = factory();
}(this, function () { 'use strict';

  var SVGNamespaceURI = 'http://www.w3.org/2000/svg';
  var COMPONENT_ID = 'liteid';
  var VELEMENT = 2;
  var VSTATELESS = 3;
  var VCOMPONENT = 4;
  var VCOMMENT = 5;

  var refs = null;

  function createVelem(type, props) {
      return {
          vtype: VELEMENT,
          type: type,
          props: props,
          refs: refs
      };
  }

  function createVstateless(type, props) {
      return {
          vtype: VSTATELESS,
          id: getUid(),
          type: type,
          props: props
      };
  }

  function createVcomponent(type, props) {
      return {
          vtype: VCOMPONENT,
          id: getUid(),
          type: type,
          props: props,
          refs: refs
      };
  }

  function createVcomment(comment) {
      return {
          vtype: VCOMMENT,
          comment: comment
      };
  }

  function initVnode(vnode, parentContext, namespaceURI) {
      var vtype = vnode.vtype;

      var node = null;
      if (!vtype) {
          node = document.createTextNode(vnode);
      } else if (vtype === VELEMENT) {
          node = initVelem(vnode, parentContext, namespaceURI);
      } else if (vtype === VCOMPONENT) {
          node = initVcomponent(vnode, parentContext, namespaceURI);
      } else if (vtype === VSTATELESS) {
          node = initVstateless(vnode, parentContext, namespaceURI);
      } else if (vtype === VCOMMENT) {
          node = document.createComment(vnode.comment);
      }
      return node;
  }

  function destroyVnode(vnode, node) {
      var vtype = vnode.vtype;

      if (vtype === VELEMENT) {
          destroyVelem(vnode, node);
      } else if (vtype === VCOMPONENT) {
          destroyVcomponent(vnode, node);
      } else if (vtype === VSTATELESS) {
          destroyVstateless(vnode, node);
      }
  }

  function initVelem(velem, parentContext, namespaceURI) {
      var type = velem.type;
      var props = velem.props;

      var node = null;

      if (type === 'svg' || namespaceURI === SVGNamespaceURI) {
          node = document.createElementNS(SVGNamespaceURI, type);
          namespaceURI = SVGNamespaceURI;
      } else {
          node = document.createElement(type);
      }

      var children = props.children;

      var vchildren = node.vchildren = [];
      if (isArr(children)) {
          flattenChildren(children, collectChild, vchildren);
      } else {
          collectChild(children, vchildren);
      }

      for (var i = 0, len = vchildren.length; i < len; i++) {
          node.appendChild(initVnode(vchildren[i], parentContext, namespaceURI));
      }

      var isCustomComponent = type.indexOf('-') >= 0 || props.is != null;
      setProps(node, props, isCustomComponent);

      attachRef(velem.refs, velem.ref, node);

      return node;
  }

  function collectChild(child, children) {
      if (child != null && typeof child !== 'boolean') {
          children[children.length] = child.vtype ? child : '' + child;
      }
  }

  function updateVelem(velem, newVelem, node, parentContext) {
      var props = velem.props;
      var type = velem.type;

      var newProps = newVelem.props;
      var oldHtml = props.dangerouslySetInnerHTML && props.dangerouslySetInnerHTML.__html;
      var newChildren = newProps.children;
      var vchildren = node.vchildren;
      var childNodes = node.childNodes;
      var namespaceURI = node.namespaceURI;

      var isCustomComponent = type.indexOf('-') >= 0 || props.is != null;
      var vchildrenLen = vchildren.length;
      var newVchildren = node.vchildren = [];

      if (isArr(newChildren)) {
          flattenChildren(newChildren, collectChild, newVchildren);
      } else {
          collectChild(newChildren, newVchildren);
      }

      var newVchildrenLen = newVchildren.length;

      if (oldHtml == null && vchildrenLen) {
          var shouldRemove = null;
          var patches = Array(newVchildrenLen);

          for (var i = 0; i < vchildrenLen; i++) {
              var vnode = vchildren[i];
              for (var j = 0; j < newVchildrenLen; j++) {
                  if (patches[j]) {
                      continue;
                  }
                  var newVnode = newVchildren[j];
                  if (vnode === newVnode) {
                      patches[j] = {
                          vnode: vnode,
                          node: childNodes[i]
                      };
                      vchildren[i] = null;
                      break;
                  }
              }
          }

          outer: for (var i = 0; i < vchildrenLen; i++) {
              var vnode = vchildren[i];
              if (vnode === null) {
                  continue;
              }
              var _type = vnode.type;
              var key = vnode.key;
              var _refs = vnode.refs;

              var childNode = childNodes[i];

              for (var j = 0; j < newVchildrenLen; j++) {
                  if (patches[j]) {
                      continue;
                  }
                  var newVnode = newVchildren[j];
                  if (newVnode.type === _type && newVnode.key === key && newVnode.refs === _refs) {
                      patches[j] = {
                          vnode: vnode,
                          node: childNode
                      };
                      continue outer;
                  }
              }

              if (!shouldRemove) {
                  shouldRemove = [];
              }
              shouldRemove[shouldRemove.length] = childNode;
              // shouldRemove.push(childNode)
              destroyVnode(vnode, childNode);
          }

          if (shouldRemove) {
              for (var i = 0, len = shouldRemove.length; i < len; i++) {
                  node.removeChild(shouldRemove[i]);
              }
          }

          for (var i = 0; i < newVchildrenLen; i++) {
              var newVnode = newVchildren[i];
              var patchItem = patches[i];
              if (patchItem) {
                  var vnode = patchItem.vnode;
                  var newChildNode = patchItem.node;
                  if (newVnode !== vnode) {
                      var vtype = newVnode.vtype;
                      if (!vtype) {
                          // textNode
                          newChildNode.nodeValue = newVnode;
                          // newChildNode.replaceData(0, vnode.length, newVnode)
                      } else if (vtype === VELEMENT) {
                              newChildNode = updateVelem(vnode, newVnode, newChildNode, parentContext);
                          } else if (vtype === VCOMPONENT) {
                              newChildNode = updateVcomponent(vnode, newVnode, newChildNode, parentContext);
                          } else if (vtype === VSTATELESS) {
                              newChildNode = updateVstateless(vnode, newVnode, newChildNode, parentContext);
                          }
                  }
                  var currentNode = childNodes[i];
                  if (currentNode !== newChildNode) {
                      node.insertBefore(newChildNode, currentNode || null);
                  }
              } else {
                  var newChildNode = initVnode(newVnode, parentContext, namespaceURI);
                  node.insertBefore(newChildNode, childNodes[i] || null);
              }
          }
          patchProps(node, props, newProps, isCustomComponent);
      } else {
          // should patch props first, make sure innerHTML was cleared
          patchProps(node, props, newProps, isCustomComponent);
          for (var i = 0; i < newVchildrenLen; i++) {
              node.appendChild(initVnode(newVchildren[i], parentContext, namespaceURI));
          }
      }

      if (velem.ref !== newVelem.ref) {
          detachRef(velem.refs, velem.ref);
          attachRef(newVelem.refs, newVelem.ref, node);
      }
      return node;
  }

  function destroyVelem(velem, node) {
      var props = velem.props;
      var vchildren = node.vchildren;
      var childNodes = node.childNodes;

      for (var i = 0, len = vchildren.length; i < len; i++) {
          destroyVnode(vchildren[i], childNodes[i]);
      }

      detachRef(velem.refs, velem.ref);

      node.eventStore = node.vchildren = null;
      for (var key in props) {
          if (props.hasOwnProperty(key) && EVENT_KEYS.test(key)) {
              key = getEventName(key);
              if (notBubbleEvents[key] === true) {
                  node[key] = null;
              }
          }
      }
  }

  function initVstateless(vstateless, parentContext, namespaceURI) {
      var vnode = renderVstateless(vstateless, parentContext);
      var node = initVnode(vnode, parentContext, namespaceURI);
      node.cache = node.cache || {};
      node.cache[vstateless.id] = vnode;
      return node;
  }
  function updateVstateless(vstateless, newVstateless, node, parentContext) {
      var id = vstateless.id;
      var vnode = node.cache[id];
      delete node.cache[id];
      var newVnode = renderVstateless(newVstateless, parentContext);
      var newNode = compareTwoVnodes(vnode, newVnode, node, parentContext);
      newNode.cache = newNode.cache || {};
      newNode.cache[newVstateless.id] = newVnode;
      if (newNode !== node) {
          extend(newNode.cache, node.cache);
      }
      return newNode;
  }
  function destroyVstateless(vstateless, node) {
      var id = vstateless.id;
      var vnode = node.cache[id];
      delete node.cache[id];
      destroyVnode(vnode, node);
  }

  function renderVstateless(vstateless, parentContext) {
      var factory = vstateless.type;
      var props = vstateless.props;

      var componentContext = getContextByTypes(parentContext, factory.contextTypes);
      var vnode = factory(props, componentContext);
      if (vnode && vnode.render) {
          vnode = vnode.render();
      }
      if (vnode === null || vnode === false) {
          vnode = createVcomment('react-empty: ' + getUid());
      } else if (!vnode || !vnode.vtype) {
          throw new Error('@' + factory.name + '#render:You may have returned undefined, an array or some other invalid object');
      }
      return vnode;
  }

  function initVcomponent(vcomponent, parentContext, namespaceURI) {
      var Component = vcomponent.type;
      var props = vcomponent.props;
      var id = vcomponent.id;

      var componentContext = getContextByTypes(parentContext, Component.contextTypes);
      var component = new Component(props, componentContext);
      var updater = component.$updater;
      var cache = component.$cache;

      cache.parentContext = parentContext;
      updater.isPending = true;
      component.props = component.props || props;
      component.context = component.context || componentContext;
      if (component.componentWillMount) {
          component.componentWillMount();
          component.state = updater.getState();
      }
      var vnode = renderComponent(component, parentContext);
      var node = initVnode(vnode, vnode.context, namespaceURI);
      node.cache = node.cache || {};
      node.cache[id] = component;
      cache.vnode = vnode;
      cache.node = node;
      cache.isMounted = true;
      pendingComponents.push(component);
      attachRef(vcomponent.refs, vcomponent.ref, component);
      return node;
  }
  function updateVcomponent(vcomponent, newVcomponent, node, parentContext) {
      var id = vcomponent.id;
      var component = node.cache[id];
      var updater = component.$updater;
      var cache = component.$cache;
      var Component = newVcomponent.type;
      var nextProps = newVcomponent.props;

      var componentContext = getContextByTypes(parentContext, Component.contextTypes);
      delete node.cache[id];
      node.cache[newVcomponent.id] = component;
      cache.parentContext = parentContext;
      if (component.componentWillReceiveProps) {
          updater.isPending = true;
          component.componentWillReceiveProps(nextProps, componentContext);
          updater.isPending = false;
      }
      updater.emitUpdate(nextProps, componentContext);

      if (vcomponent.ref !== newVcomponent.ref) {
          detachRef(vcomponent.refs, vcomponent.ref);
          attachRef(newVcomponent.refs, newVcomponent.ref, component);
      }
      return cache.node;
  }
  function destroyVcomponent(vcomponent, node) {
      var id = vcomponent.id;
      var component = node.cache[id];
      var cache = component.$cache;
      delete node.cache[id];
      detachRef(vcomponent.refs, vcomponent.ref);
      component.setState = component.forceUpdate = noop;
      if (component.componentWillUnmount) {
          component.componentWillUnmount();
      }
      destroyVnode(cache.vnode, node);
      delete component.setState;
      cache.isMounted = false;
      cache.node = cache.parentContext = cache.vnode = component.refs = component.context = null;
  }

  function getContextByTypes(curContext, contextTypes) {
      var context = {};
      if (!contextTypes || !curContext) {
          return context;
      }
      for (var key in contextTypes) {
          if (contextTypes.hasOwnProperty(key)) {
              context[key] = curContext[key];
          }
      }
      return context;
  }

  function renderComponent(component, parentContext) {
      refs = component.refs;
      var vnode = component.render();

      if (vnode === null || vnode === false) {
          vnode = createVcomment('react-empty: ' + getUid());
      } else if (!vnode || !vnode.vtype) {
          throw new Error('@' + component.constructor.name + '#render:You may have returned undefined, an array or some other invalid object');
      }

      var curContext = refs = null;
      if (component.getChildContext) {
          curContext = component.getChildContext();
      }
      if (curContext) {
          curContext = extend(extend({}, parentContext), curContext);
      } else {
          curContext = parentContext;
      }
      vnode.context = curContext;
      return vnode;
  }

  var pendingComponents = [];

  function clearPendingComponents() {
      var components = pendingComponents;
      var len = components.length;
      if (!len) {
          return;
      }
      pendingComponents = [];
      var i = -1;
      while (len--) {
          var component = components[++i];
          var updater = component.$updater;
          if (component.componentDidMount) {
              component.componentDidMount();
          }
          updater.isPending = false;
          updater.emitUpdate();
      }
  }

  function compareTwoVnodes(vnode, newVnode, node, parentContext) {
      var newNode = node;

      if (newVnode == null) {
          // remove
          destroyVnode(vnode, node);
          node.parentNode.removeChild(node);
      } else if (vnode.type !== newVnode.type || newVnode.key !== vnode.key) {
          // replace
          destroyVnode(vnode, node);
          newNode = initVnode(newVnode, parentContext, node.namespaceURI);
          node.parentNode.replaceChild(newNode, node);
      } else if (vnode !== newVnode) {
          // same type and same key -> update
          var vtype = vnode.vtype;
          if (vtype === VELEMENT) {
              newNode = updateVelem(vnode, newVnode, node, parentContext);
          } else if (vtype === VCOMPONENT) {
              newNode = updateVcomponent(vnode, newVnode, node, parentContext);
          } else if (vtype === VSTATELESS) {
              newNode = updateVstateless(vnode, newVnode, node, parentContext);
          }
      }

      return newNode;
  }

  function getDOMNode() {
      return this;
  }

  function attachRef(refs, refKey, refValue) {
      if (!refs || refKey == null || !refValue) {
          return;
      }
      if (refValue.nodeName && !refValue.getDOMNode) {
          // support react v0.13 style: this.refs.myInput.getDOMNode()
          refValue.getDOMNode = getDOMNode;
      }
      if (isFn(refKey)) {
          refKey(refValue);
      } else {
          refs[refKey] = refValue;
      }
  }

  function detachRef(refs, refKey) {
      if (!refs || refKey == null) {
          return;
      }
      if (isFn(refKey)) {
          refKey(null);
      } else {
          delete refs[refKey];
      }
  }

  var updateQueue = {
  	updaters: [],
  	isPending: false,
  	add: function add(updater) {
  		this.updaters.push(updater);
  	},
  	batchUpdate: function batchUpdate() {
  		if (this.isPending) {
  			return;
  		}
  		this.isPending = true;
  		/*
     each updater.update may add new updater to updateQueue
     clear them with a loop
     event bubbles from bottom-level to top-level
     reverse the updater order can merge some props and state and reduce the refresh times
     see Updater.update method below to know why
    */
  		var updaters = this.updaters;

  		var updater = undefined;
  		while (updater = updaters.pop()) {
  			updater.updateComponent();
  		}
  		this.isPending = false;
  	}
  };

  function Updater(instance) {
  	this.instance = instance;
  	this.pendingStates = [];
  	this.pendingCallbacks = [];
  	this.isPending = false;
  	this.nextProps = this.nextContext = null;
  	this.clearCallbacks = this.clearCallbacks.bind(this);
  }

  Updater.prototype = {
  	emitUpdate: function emitUpdate(nextProps, nextContext) {
  		this.nextProps = nextProps;
  		this.nextContext = nextContext;
  		// receive nextProps!! should update immediately
  		nextProps || !updateQueue.isPending ? this.updateComponent() : updateQueue.add(this);
  	},
  	updateComponent: function updateComponent() {
  		var instance = this.instance;
  		var pendingStates = this.pendingStates;
  		var nextProps = this.nextProps;
  		var nextContext = this.nextContext;

  		if (nextProps || pendingStates.length > 0) {
  			nextProps = nextProps || instance.props;
  			nextContext = nextContext || instance.context;
  			this.nextProps = this.nextContext = null;
  			// merge the nextProps and nextState and update by one time
  			shouldUpdate(instance, nextProps, this.getState(), nextContext, this.clearCallbacks);
  		}
  	},
  	addState: function addState(nextState) {
  		if (nextState) {
  			this.pendingStates.push(nextState);
  			if (!this.isPending) {
  				this.emitUpdate();
  			}
  		}
  	},
  	replaceState: function replaceState(nextState) {
  		var pendingStates = this.pendingStates;

  		pendingStates.pop();
  		// push special params to point out should replace state
  		pendingStates.push([nextState]);
  	},
  	getState: function getState() {
  		var instance = this.instance;
  		var pendingStates = this.pendingStates;
  		var state = instance.state;
  		var props = instance.props;

  		if (pendingStates.length) {
  			state = extend({}, state);
  			eachItem(pendingStates, function (nextState) {
  				// replace state
  				if (isArr(nextState)) {
  					state = extend({}, nextState[0]);
  					return;
  				}
  				if (isFn(nextState)) {
  					nextState = nextState.call(instance, state, props);
  				}
  				extend(state, nextState);
  			});
  			pendingStates.length = 0;
  		}
  		return state;
  	},
  	clearCallbacks: function clearCallbacks() {
  		var pendingCallbacks = this.pendingCallbacks;
  		var instance = this.instance;

  		if (pendingCallbacks.length > 0) {
  			this.pendingCallbacks = [];
  			eachItem(pendingCallbacks, function (callback) {
  				return callback.call(instance);
  			});
  		}
  	},
  	addCallback: function addCallback(callback) {
  		if (isFn(callback)) {
  			this.pendingCallbacks.push(callback);
  		}
  	}
  };
  function Component(props, context) {
  	this.$updater = new Updater(this);
  	this.$cache = { isMounted: false };
  	this.props = props;
  	this.state = {};
  	this.refs = {};
  	this.context = context;
  }

  Component.prototype = {
  	constructor: Component,
  	// getChildContext: _.noop,
  	// componentWillUpdate: _.noop,
  	// componentDidUpdate: _.noop,
  	// componentWillReceiveProps: _.noop,
  	// componentWillMount: _.noop,
  	// componentDidMount: _.noop,
  	// componentWillUnmount: _.noop,
  	// shouldComponentUpdate(nextProps, nextState) {
  	// 	return true
  	// },
  	forceUpdate: function forceUpdate(callback) {
  		var $updater = this.$updater;
  		var $cache = this.$cache;
  		var props = this.props;
  		var state = this.state;
  		var context = this.context;

  		if ($updater.isPending || !$cache.isMounted) {
  			return;
  		}
  		var nextProps = $cache.props || props;
  		var nextState = $cache.state || state;
  		var nextContext = $cache.context || {};
  		var parentContext = $cache.parentContext;
  		var node = $cache.node;
  		var vnode = $cache.vnode;
  		$cache.props = $cache.state = $cache.context = null;
  		$updater.isPending = true;
  		if (this.componentWillUpdate) {
  			this.componentWillUpdate(nextProps, nextState, nextContext);
  		}
  		this.state = nextState;
  		this.props = nextProps;
  		this.context = nextContext;
  		var newVnode = renderComponent(this, parentContext);
  		var newNode = compareTwoVnodes(vnode, newVnode, node, newVnode.context);
  		if (newNode !== node) {
  			newNode.cache = newNode.cache || {};
  			extend(newNode.cache, node.cache);
  		}
  		$cache.vnode = newVnode;
  		$cache.node = newNode;
  		clearPendingComponents();
  		if (this.componentDidUpdate) {
  			this.componentDidUpdate(props, state, context);
  		}
  		if (callback) {
  			callback.call(this);
  		}
  		$updater.isPending = false;
  		$updater.emitUpdate();
  	},
  	setState: function setState(nextState, callback) {
  		var $updater = this.$updater;

  		$updater.addCallback(callback);
  		$updater.addState(nextState);
  	},
  	replaceState: function replaceState(nextState, callback) {
  		var $updater = this.$updater;

  		$updater.addCallback(callback);
  		$updater.replaceState(nextState);
  	},
  	getDOMNode: function getDOMNode() {
  		var node = this.$cache.node;
  		return node && node.nodeName === '#comment' ? null : node;
  	},
  	isMounted: function isMounted() {
  		return this.$cache.isMounted;
  	}
  };

  function shouldUpdate(component, nextProps, nextState, nextContext, callback) {
  	var shouldComponentUpdate = true;
  	if (component.shouldComponentUpdate) {
  		shouldComponentUpdate = component.shouldComponentUpdate(nextProps, nextState, nextContext);
  	}
  	if (shouldComponentUpdate === false) {
  		component.props = nextProps;
  		component.state = nextState;
  		component.context = nextContext || {};
  		return;
  	}
  	var cache = component.$cache;
  	cache.props = nextProps;
  	cache.state = nextState;
  	cache.context = nextContext || {};
  	component.forceUpdate(callback);
  }

  // event config
  var notBubbleEvents = {
  	onmouseleave: 1,
  	onmouseenter: 1,
  	onload: 1,
  	onunload: 1,
  	onscroll: 1,
  	onfocus: 1,
  	onblur: 1,
  	onrowexit: 1,
  	onbeforeunload: 1,
  	onstop: 1,
  	ondragdrop: 1,
  	ondragenter: 1,
  	ondragexit: 1,
  	ondraggesture: 1,
  	ondragover: 1,
  	oncontextmenu: 1
  };

  function getEventName(key) {
  	key = key === 'onDoubleClick' ? 'ondblclick' : key;
  	return key.toLowerCase();
  }

  var eventTypes = {};

  function addEvent(elem, eventType, listener) {
  	eventType = getEventName(eventType);

  	if (notBubbleEvents[eventType] === 1) {
  		elem[eventType] = listener;
  		return;
  	}

  	var eventStore = elem.eventStore || (elem.eventStore = {});
  	eventStore[eventType] = listener;

  	if (!eventTypes[eventType]) {
  		// onclick -> click
  		document.addEventListener(eventType.substr(2), dispatchEvent);
  		eventTypes[eventType] = true;
  	}

  	var nodeName = elem.nodeName;

  	if (eventType === 'onchange' && (nodeName === 'INPUT' || nodeName === 'TEXTAREA')) {
  		addEvent(elem, 'oninput', listener);
  	}
  }

  function removeEvent(elem, eventType) {
  	eventType = getEventName(eventType);
  	if (notBubbleEvents[eventType] === 1) {
  		elem[eventType] = null;
  		return;
  	}

  	var eventStore = elem.eventStore || (elem.eventStore = {});
  	delete eventStore[eventType];

  	var nodeName = elem.nodeName;

  	if (eventType === 'onchange' && (nodeName === 'INPUT' || nodeName === 'TEXTAREA')) {
  		delete eventStore['oninput'];
  	}
  }

  function dispatchEvent(event) {
  	var target = event.target;
  	var type = event.type;

  	var eventType = 'on' + type;
  	var syntheticEvent = undefined;
  	updateQueue.isPending = true;
  	while (target) {
  		var _target = target;
  		var eventStore = _target.eventStore;

  		var listener = eventStore && eventStore[eventType];
  		if (!listener) {
  			target = target.parentNode;
  			continue;
  		}
  		if (!syntheticEvent) {
  			syntheticEvent = createSyntheticEvent(event);
  		}
  		syntheticEvent.currentTarget = target;
  		listener.call(target, syntheticEvent);
  		if (syntheticEvent.$cancalBubble) {
  			break;
  		}
  		target = target.parentNode;
  	}
  	updateQueue.isPending = false;
  	updateQueue.batchUpdate();
  }

  function createSyntheticEvent(nativeEvent) {
  	var syntheticEvent = {};
  	var cancalBubble = function cancalBubble() {
  		return syntheticEvent.$cancalBubble = true;
  	};
  	syntheticEvent.nativeEvent = nativeEvent;
  	for (var key in nativeEvent) {
  		if (typeof nativeEvent[key] !== 'function') {
  			syntheticEvent[key] = nativeEvent[key];
  		} else if (key === 'stopPropagation' || key === 'stopImmediatePropagation') {
  			syntheticEvent[key] = cancalBubble;
  		} else {
  			syntheticEvent[key] = nativeEvent[key].bind(nativeEvent);
  		}
  	}
  	return syntheticEvent;
  }

  function setStyle(elemStyle, styles) {
      for (var styleName in styles) {
          if (styles.hasOwnProperty(styleName)) {
              setStyleValue(elemStyle, styleName, styles[styleName]);
          }
      }
  }

  function removeStyle(elemStyle, styles) {
      for (var styleName in styles) {
          if (styles.hasOwnProperty(styleName)) {
              elemStyle[styleName] = '';
          }
      }
  }

  function patchStyle(elemStyle, style, newStyle) {
      if (style === newStyle) {
          return;
      }
      if (!newStyle && style) {
          removeStyle(elemStyle, style);
          return;
      } else if (newStyle && !style) {
          setStyle(elemStyle, newStyle);
          return;
      }

      var keyMap = {};
      for (var key in style) {
          if (style.hasOwnProperty(key)) {
              keyMap[key] = true;
              if (style[key] !== newStyle[key]) {
                  setStyleValue(elemStyle, key, newStyle[key]);
              }
          }
      }
      for (var key in newStyle) {
          if (newStyle.hasOwnProperty(key) && keyMap[key] !== true) {
              if (style[key] !== newStyle[key]) {
                  setStyleValue(elemStyle, key, newStyle[key]);
              }
          }
      }
  }

  /**
   * CSS properties which accept numbers but are not in units of "px".
   */
  var isUnitlessNumber = {
      animationIterationCount: 1,
      borderImageOutset: 1,
      borderImageSlice: 1,
      borderImageWidth: 1,
      boxFlex: 1,
      boxFlexGroup: 1,
      boxOrdinalGroup: 1,
      columnCount: 1,
      flex: 1,
      flexGrow: 1,
      flexPositive: 1,
      flexShrink: 1,
      flexNegative: 1,
      flexOrder: 1,
      gridRow: 1,
      gridColumn: 1,
      fontWeight: 1,
      lineClamp: 1,
      lineHeight: 1,
      opacity: 1,
      order: 1,
      orphans: 1,
      tabSize: 1,
      widows: 1,
      zIndex: 1,
      zoom: 1,

      // SVG-related properties
      fillOpacity: 1,
      floodOpacity: 1,
      stopOpacity: 1,
      strokeDasharray: 1,
      strokeDashoffset: 1,
      strokeMiterlimit: 1,
      strokeOpacity: 1,
      strokeWidth: 1
  };

  function prefixKey(prefix, key) {
      return prefix + key.charAt(0).toUpperCase() + key.substring(1);
  }

  var prefixes = ['Webkit', 'ms', 'Moz', 'O'];

  Object.keys(isUnitlessNumber).forEach(function (prop) {
      prefixes.forEach(function (prefix) {
          isUnitlessNumber[prefixKey(prefix, prop)] = 1;
      });
  });

  var RE_NUMBER = /^-?\d+(\.\d+)?$/;
  function setStyleValue(elemStyle, styleName, styleValue) {

      if (!isUnitlessNumber[styleName] && RE_NUMBER.test(styleValue)) {
          elemStyle[styleName] = styleValue + 'px';
          return;
      }

      if (styleName === 'float') {
          styleName = 'cssFloat';
      }

      if (styleValue == null || typeof styleValue === 'boolean') {
          styleValue = '';
      }

      elemStyle[styleName] = styleValue;
  }

  var ATTRIBUTE_NAME_START_CHAR = ':A-Z_a-z\\u00C0-\\u00D6\\u00D8-\\u00F6\\u00F8-\\u02FF\\u0370-\\u037D\\u037F-\\u1FFF\\u200C-\\u200D\\u2070-\\u218F\\u2C00-\\u2FEF\\u3001-\\uD7FF\\uF900-\\uFDCF\\uFDF0-\\uFFFD';
  var ATTRIBUTE_NAME_CHAR = ATTRIBUTE_NAME_START_CHAR + '\\-.0-9\\uB7\\u0300-\\u036F\\u203F-\\u2040';

  var VALID_ATTRIBUTE_NAME_REGEX = new RegExp('^[' + ATTRIBUTE_NAME_START_CHAR + '][' + ATTRIBUTE_NAME_CHAR + ']*$');

  var isCustomAttribute = RegExp.prototype.test.bind(new RegExp('^(data|aria)-[' + ATTRIBUTE_NAME_CHAR + ']*$'));
  // will merge some data in properties below
  var properties = {};

  /**
   * Mapping from normalized, camelcased property names to a configuration that
   * specifies how the associated DOM property should be accessed or rendered.
   */
  var MUST_USE_PROPERTY = 0x1;
  var HAS_BOOLEAN_VALUE = 0x4;
  var HAS_NUMERIC_VALUE = 0x8;
  var HAS_POSITIVE_NUMERIC_VALUE = 0x10 | 0x8;
  var HAS_OVERLOADED_BOOLEAN_VALUE = 0x20;

  // html config
  var HTMLDOMPropertyConfig = {
      props: {
          /**
           * Standard Properties
           */
          accept: 0,
          acceptCharset: 0,
          accessKey: 0,
          action: 0,
          allowFullScreen: HAS_BOOLEAN_VALUE,
          allowTransparency: 0,
          alt: 0,
          async: HAS_BOOLEAN_VALUE,
          autoComplete: 0,
          autoFocus: HAS_BOOLEAN_VALUE,
          autoPlay: HAS_BOOLEAN_VALUE,
          capture: HAS_BOOLEAN_VALUE,
          cellPadding: 0,
          cellSpacing: 0,
          charSet: 0,
          challenge: 0,
          checked: MUST_USE_PROPERTY | HAS_BOOLEAN_VALUE,
          cite: 0,
          classID: 0,
          className: 0,
          cols: HAS_POSITIVE_NUMERIC_VALUE,
          colSpan: 0,
          content: 0,
          contentEditable: 0,
          contextMenu: 0,
          controls: HAS_BOOLEAN_VALUE,
          coords: 0,
          crossOrigin: 0,
          data: 0, // For `<object />` acts as `src`.
          dateTime: 0,
          'default': HAS_BOOLEAN_VALUE,
          // not in regular react, they did it in other way
          defaultValue: MUST_USE_PROPERTY,
          // not in regular react, they did it in other way
          defaultChecked: MUST_USE_PROPERTY | HAS_BOOLEAN_VALUE,
          defer: HAS_BOOLEAN_VALUE,
          dir: 0,
          disabled: HAS_BOOLEAN_VALUE,
          download: HAS_OVERLOADED_BOOLEAN_VALUE,
          draggable: 0,
          encType: 0,
          form: 0,
          formAction: 0,
          formEncType: 0,
          formMethod: 0,
          formNoValidate: HAS_BOOLEAN_VALUE,
          formTarget: 0,
          frameBorder: 0,
          headers: 0,
          height: 0,
          hidden: HAS_BOOLEAN_VALUE,
          high: 0,
          href: 0,
          hrefLang: 0,
          htmlFor: 0,
          httpEquiv: 0,
          icon: 0,
          id: 0,
          inputMode: 0,
          integrity: 0,
          is: 0,
          keyParams: 0,
          keyType: 0,
          kind: 0,
          label: 0,
          lang: 0,
          list: 0,
          loop: HAS_BOOLEAN_VALUE,
          low: 0,
          manifest: 0,
          marginHeight: 0,
          marginWidth: 0,
          max: 0,
          maxLength: 0,
          media: 0,
          mediaGroup: 0,
          method: 0,
          min: 0,
          minLength: 0,
          // Caution; `option.selected` is not updated if `select.multiple` is
          // disabled with `removeAttribute`.
          multiple: MUST_USE_PROPERTY | HAS_BOOLEAN_VALUE,
          muted: MUST_USE_PROPERTY | HAS_BOOLEAN_VALUE,
          name: 0,
          nonce: 0,
          noValidate: HAS_BOOLEAN_VALUE,
          open: HAS_BOOLEAN_VALUE,
          optimum: 0,
          pattern: 0,
          placeholder: 0,
          poster: 0,
          preload: 0,
          profile: 0,
          radioGroup: 0,
          readOnly: HAS_BOOLEAN_VALUE,
          rel: 0,
          required: HAS_BOOLEAN_VALUE,
          reversed: HAS_BOOLEAN_VALUE,
          role: 0,
          rows: HAS_POSITIVE_NUMERIC_VALUE,
          rowSpan: HAS_NUMERIC_VALUE,
          sandbox: 0,
          scope: 0,
          scoped: HAS_BOOLEAN_VALUE,
          scrolling: 0,
          seamless: HAS_BOOLEAN_VALUE,
          selected: MUST_USE_PROPERTY | HAS_BOOLEAN_VALUE,
          shape: 0,
          size: HAS_POSITIVE_NUMERIC_VALUE,
          sizes: 0,
          span: HAS_POSITIVE_NUMERIC_VALUE,
          spellCheck: 0,
          src: 0,
          srcDoc: 0,
          srcLang: 0,
          srcSet: 0,
          start: HAS_NUMERIC_VALUE,
          step: 0,
          style: 0,
          summary: 0,
          tabIndex: 0,
          target: 0,
          title: 0,
          // Setting .type throws on non-<input> tags
          type: 0,
          useMap: 0,
          value: MUST_USE_PROPERTY,
          width: 0,
          wmode: 0,
          wrap: 0,

          /**
           * RDFa Properties
           */
          about: 0,
          datatype: 0,
          inlist: 0,
          prefix: 0,
          // property is also supported for OpenGraph in meta tags.
          property: 0,
          resource: 0,
          'typeof': 0,
          vocab: 0,

          /**
           * Non-standard Properties
           */
          // autoCapitalize and autoCorrect are supported in Mobile Safari for
          // keyboard hints.
          autoCapitalize: 0,
          autoCorrect: 0,
          // autoSave allows WebKit/Blink to persist values of input fields on page reloads
          autoSave: 0,
          // color is for Safari mask-icon link
          color: 0,
          // itemProp, itemScope, itemType are for
          // Microdata support. See http://schema.org/docs/gs.html
          itemProp: 0,
          itemScope: HAS_BOOLEAN_VALUE,
          itemType: 0,
          // itemID and itemRef are for Microdata support as well but
          // only specified in the WHATWG spec document. See
          // https://html.spec.whatwg.org/multipage/microdata.html#microdata-dom-api
          itemID: 0,
          itemRef: 0,
          // results show looking glass icon and recent searches on input
          // search fields in WebKit/Blink
          results: 0,
          // IE-only attribute that specifies security restrictions on an iframe
          // as an alternative to the sandbox attribute on IE<10
          security: 0,
          // IE-only attribute that controls focus behavior
          unselectable: 0
      },
      attrNS: {},
      domAttrs: {
          acceptCharset: 'accept-charset',
          className: 'class',
          htmlFor: 'for',
          httpEquiv: 'http-equiv'
      },
      domProps: {}
  };

  // svg config
  var xlink = 'http://www.w3.org/1999/xlink';
  var xml = 'http://www.w3.org/XML/1998/namespace';

  // We use attributes for everything SVG so let's avoid some duplication and run
  // code instead.
  // The following are all specified in the HTML config already so we exclude here.
  // - class (as className)
  // - color
  // - height
  // - id
  // - lang
  // - max
  // - media
  // - method
  // - min
  // - name
  // - style
  // - target
  // - type
  // - width
  var ATTRS = {
      accentHeight: 'accent-height',
      accumulate: 0,
      additive: 0,
      alignmentBaseline: 'alignment-baseline',
      allowReorder: 'allowReorder',
      alphabetic: 0,
      amplitude: 0,
      arabicForm: 'arabic-form',
      ascent: 0,
      attributeName: 'attributeName',
      attributeType: 'attributeType',
      autoReverse: 'autoReverse',
      azimuth: 0,
      baseFrequency: 'baseFrequency',
      baseProfile: 'baseProfile',
      baselineShift: 'baseline-shift',
      bbox: 0,
      begin: 0,
      bias: 0,
      by: 0,
      calcMode: 'calcMode',
      capHeight: 'cap-height',
      clip: 0,
      clipPath: 'clip-path',
      clipRule: 'clip-rule',
      clipPathUnits: 'clipPathUnits',
      colorInterpolation: 'color-interpolation',
      colorInterpolationFilters: 'color-interpolation-filters',
      colorProfile: 'color-profile',
      colorRendering: 'color-rendering',
      contentScriptType: 'contentScriptType',
      contentStyleType: 'contentStyleType',
      cursor: 0,
      cx: 0,
      cy: 0,
      d: 0,
      decelerate: 0,
      descent: 0,
      diffuseConstant: 'diffuseConstant',
      direction: 0,
      display: 0,
      divisor: 0,
      dominantBaseline: 'dominant-baseline',
      dur: 0,
      dx: 0,
      dy: 0,
      edgeMode: 'edgeMode',
      elevation: 0,
      enableBackground: 'enable-background',
      end: 0,
      exponent: 0,
      externalResourcesRequired: 'externalResourcesRequired',
      fill: 0,
      fillOpacity: 'fill-opacity',
      fillRule: 'fill-rule',
      filter: 0,
      filterRes: 'filterRes',
      filterUnits: 'filterUnits',
      floodColor: 'flood-color',
      floodOpacity: 'flood-opacity',
      focusable: 0,
      fontFamily: 'font-family',
      fontSize: 'font-size',
      fontSizeAdjust: 'font-size-adjust',
      fontStretch: 'font-stretch',
      fontStyle: 'font-style',
      fontVariant: 'font-variant',
      fontWeight: 'font-weight',
      format: 0,
      from: 0,
      fx: 0,
      fy: 0,
      g1: 0,
      g2: 0,
      glyphName: 'glyph-name',
      glyphOrientationHorizontal: 'glyph-orientation-horizontal',
      glyphOrientationVertical: 'glyph-orientation-vertical',
      glyphRef: 'glyphRef',
      gradientTransform: 'gradientTransform',
      gradientUnits: 'gradientUnits',
      hanging: 0,
      horizAdvX: 'horiz-adv-x',
      horizOriginX: 'horiz-origin-x',
      ideographic: 0,
      imageRendering: 'image-rendering',
      'in': 0,
      in2: 0,
      intercept: 0,
      k: 0,
      k1: 0,
      k2: 0,
      k3: 0,
      k4: 0,
      kernelMatrix: 'kernelMatrix',
      kernelUnitLength: 'kernelUnitLength',
      kerning: 0,
      keyPoints: 'keyPoints',
      keySplines: 'keySplines',
      keyTimes: 'keyTimes',
      lengthAdjust: 'lengthAdjust',
      letterSpacing: 'letter-spacing',
      lightingColor: 'lighting-color',
      limitingConeAngle: 'limitingConeAngle',
      local: 0,
      markerEnd: 'marker-end',
      markerMid: 'marker-mid',
      markerStart: 'marker-start',
      markerHeight: 'markerHeight',
      markerUnits: 'markerUnits',
      markerWidth: 'markerWidth',
      mask: 0,
      maskContentUnits: 'maskContentUnits',
      maskUnits: 'maskUnits',
      mathematical: 0,
      mode: 0,
      numOctaves: 'numOctaves',
      offset: 0,
      opacity: 0,
      operator: 0,
      order: 0,
      orient: 0,
      orientation: 0,
      origin: 0,
      overflow: 0,
      overlinePosition: 'overline-position',
      overlineThickness: 'overline-thickness',
      paintOrder: 'paint-order',
      panose1: 'panose-1',
      pathLength: 'pathLength',
      patternContentUnits: 'patternContentUnits',
      patternTransform: 'patternTransform',
      patternUnits: 'patternUnits',
      pointerEvents: 'pointer-events',
      points: 0,
      pointsAtX: 'pointsAtX',
      pointsAtY: 'pointsAtY',
      pointsAtZ: 'pointsAtZ',
      preserveAlpha: 'preserveAlpha',
      preserveAspectRatio: 'preserveAspectRatio',
      primitiveUnits: 'primitiveUnits',
      r: 0,
      radius: 0,
      refX: 'refX',
      refY: 'refY',
      renderingIntent: 'rendering-intent',
      repeatCount: 'repeatCount',
      repeatDur: 'repeatDur',
      requiredExtensions: 'requiredExtensions',
      requiredFeatures: 'requiredFeatures',
      restart: 0,
      result: 0,
      rotate: 0,
      rx: 0,
      ry: 0,
      scale: 0,
      seed: 0,
      shapeRendering: 'shape-rendering',
      slope: 0,
      spacing: 0,
      specularConstant: 'specularConstant',
      specularExponent: 'specularExponent',
      speed: 0,
      spreadMethod: 'spreadMethod',
      startOffset: 'startOffset',
      stdDeviation: 'stdDeviation',
      stemh: 0,
      stemv: 0,
      stitchTiles: 'stitchTiles',
      stopColor: 'stop-color',
      stopOpacity: 'stop-opacity',
      strikethroughPosition: 'strikethrough-position',
      strikethroughThickness: 'strikethrough-thickness',
      string: 0,
      stroke: 0,
      strokeDasharray: 'stroke-dasharray',
      strokeDashoffset: 'stroke-dashoffset',
      strokeLinecap: 'stroke-linecap',
      strokeLinejoin: 'stroke-linejoin',
      strokeMiterlimit: 'stroke-miterlimit',
      strokeOpacity: 'stroke-opacity',
      strokeWidth: 'stroke-width',
      surfaceScale: 'surfaceScale',
      systemLanguage: 'systemLanguage',
      tableValues: 'tableValues',
      targetX: 'targetX',
      targetY: 'targetY',
      textAnchor: 'text-anchor',
      textDecoration: 'text-decoration',
      textRendering: 'text-rendering',
      textLength: 'textLength',
      to: 0,
      transform: 0,
      u1: 0,
      u2: 0,
      underlinePosition: 'underline-position',
      underlineThickness: 'underline-thickness',
      unicode: 0,
      unicodeBidi: 'unicode-bidi',
      unicodeRange: 'unicode-range',
      unitsPerEm: 'units-per-em',
      vAlphabetic: 'v-alphabetic',
      vHanging: 'v-hanging',
      vIdeographic: 'v-ideographic',
      vMathematical: 'v-mathematical',
      values: 0,
      vectorEffect: 'vector-effect',
      version: 0,
      vertAdvY: 'vert-adv-y',
      vertOriginX: 'vert-origin-x',
      vertOriginY: 'vert-origin-y',
      viewBox: 'viewBox',
      viewTarget: 'viewTarget',
      visibility: 0,
      widths: 0,
      wordSpacing: 'word-spacing',
      writingMode: 'writing-mode',
      x: 0,
      xHeight: 'x-height',
      x1: 0,
      x2: 0,
      xChannelSelector: 'xChannelSelector',
      xlinkActuate: 'xlink:actuate',
      xlinkArcrole: 'xlink:arcrole',
      xlinkHref: 'xlink:href',
      xlinkRole: 'xlink:role',
      xlinkShow: 'xlink:show',
      xlinkTitle: 'xlink:title',
      xlinkType: 'xlink:type',
      xmlBase: 'xml:base',
      xmlLang: 'xml:lang',
      xmlSpace: 'xml:space',
      y: 0,
      y1: 0,
      y2: 0,
      yChannelSelector: 'yChannelSelector',
      z: 0,
      zoomAndPan: 'zoomAndPan'
  };

  var SVGDOMPropertyConfig = {
      props: {},
      attrNS: {
          xlinkActuate: xlink,
          xlinkArcrole: xlink,
          xlinkHref: xlink,
          xlinkRole: xlink,
          xlinkShow: xlink,
          xlinkTitle: xlink,
          xlinkType: xlink,
          xmlBase: xml,
          xmlLang: xml,
          xmlSpace: xml
      },
      domAttrs: {},
      domProps: {}
  };

  Object.keys(ATTRS).map(function (key) {
      SVGDOMPropertyConfig.props[key] = 0;
      if (ATTRS[key]) {
          SVGDOMPropertyConfig.domAttrs[key] = ATTRS[key];
      }
  });

  // merge html and svg config into properties
  mergeConfigToProperties(HTMLDOMPropertyConfig);
  mergeConfigToProperties(SVGDOMPropertyConfig);

  function mergeConfigToProperties(config) {
      var
      // all react/react-lite supporting property names in here
      props = config.props;
      var
      // attributes namespace in here
      attrNS = config.attrNS;
      var
      // propName in props which should use to be dom-attribute in here
      domAttrs = config.domAttrs;
      var
      // propName in props which should use to be dom-property in here
      domProps = config.domProps;

      for (var propName in props) {
          if (!props.hasOwnProperty(propName)) {
              continue;
          }
          var propConfig = props[propName];
          properties[propName] = {
              attributeName: domAttrs.hasOwnProperty(propName) ? domAttrs[propName] : propName.toLowerCase(),
              propertyName: domProps.hasOwnProperty(propName) ? domProps[propName] : propName,
              attributeNamespace: attrNS.hasOwnProperty(propName) ? attrNS[propName] : null,
              mustUseProperty: checkMask(propConfig, MUST_USE_PROPERTY),
              hasBooleanValue: checkMask(propConfig, HAS_BOOLEAN_VALUE),
              hasNumericValue: checkMask(propConfig, HAS_NUMERIC_VALUE),
              hasPositiveNumericValue: checkMask(propConfig, HAS_POSITIVE_NUMERIC_VALUE),
              hasOverloadedBooleanValue: checkMask(propConfig, HAS_OVERLOADED_BOOLEAN_VALUE)
          };
      }
  }

  function checkMask(value, bitmask) {
      return (value & bitmask) === bitmask;
  }

  /**
   * Sets the value for a property on a node.
   *
   * @param {DOMElement} node
   * @param {string} name
   * @param {*} value
   */

  function setPropValue(node, name, value) {
      var propInfo = properties.hasOwnProperty(name) && properties[name];
      if (propInfo) {
          // should delete value from dom
          if (value == null || propInfo.hasBooleanValue && !value || propInfo.hasNumericValue && isNaN(value) || propInfo.hasPositiveNumericValue && value < 1 || propInfo.hasOverloadedBooleanValue && value === false) {
              removePropValue(node, name);
          } else if (propInfo.mustUseProperty) {
              node[propInfo.propertyName] = value;
          } else {
              var attributeName = propInfo.attributeName;
              var namespace = propInfo.attributeNamespace;

              // `setAttribute` with objects becomes only `[object]` in IE8/9,
              // ('' + value) makes it output the correct toString()-value.
              if (namespace) {
                  node.setAttributeNS(namespace, attributeName, '' + value);
              } else if (propInfo.hasBooleanValue || propInfo.hasOverloadedBooleanValue && value === true) {
                  node.setAttribute(attributeName, '');
              } else {
                  node.setAttribute(attributeName, '' + value);
              }
          }
      } else if (isCustomAttribute(name) && VALID_ATTRIBUTE_NAME_REGEX.test(name)) {
          if (value == null) {
              node.removeAttribute(name);
          } else {
              node.setAttribute(name, '' + value);
          }
      }
  }

  /**
   * Deletes the value for a property on a node.
   *
   * @param {DOMElement} node
   * @param {string} name
   */

  function removePropValue(node, name) {
      var propInfo = properties.hasOwnProperty(name) && properties[name];
      if (propInfo) {
          if (propInfo.mustUseProperty) {
              node[propInfo.propertyName] = propInfo.hasBooleanValue ? false : '';
          } else {
              node.removeAttribute(propInfo.attributeName);
          }
      } else if (isCustomAttribute(name)) {
          node.removeAttribute(name);
      }
  }

  function isFn(obj) {
      return typeof obj === 'function';
  }

  var isArr = Array.isArray;

  function noop() {}

  function identity(obj) {
      return obj;
  }

  function pipe(fn1, fn2) {
      return function () {
          fn1.apply(this, arguments);
          return fn2.apply(this, arguments);
      };
  }

  function flattenChildren(list, iteratee, a) {
      var len = list.length;
      var i = -1;

      while (len--) {
          var item = list[++i];
          if (isArr(item)) {
              flattenChildren(item, iteratee, a);
          } else {
              iteratee(item, a);
          }
      }
  }

  function eachItem(list, iteratee) {
      for (var i = 0, len = list.length; i < len; i++) {
          iteratee(list[i], i);
      }
  }

  function extend(to) /* sources */{
      var nextSource, nextIndex;
      for (nextIndex = 1; nextIndex < arguments.length; nextIndex++) {
          nextSource = arguments[nextIndex];
          if (nextSource == null) {
              continue;
          }
      }
      var from = Object(nextSource);
      if (!from) {
          return to;
      }
      var keys = Object.keys(from);
      var i = keys.length;
      while (i--) {
          if (from[keys[i]] !== undefined) {
              to[keys[i]] = from[keys[i]];
          }
      }
      return to;
  }

  var uid = 0;

  function getUid() {
      return ++uid;
  }

  var EVENT_KEYS = /^on/i;
  function setProps(elem, props, isCustomComponent) {
      for (var key in props) {
          if (!props.hasOwnProperty(key) || key === 'children') {
              continue;
          }
          var value = props[key];
          if (EVENT_KEYS.test(key)) {
              addEvent(elem, key, value);
          } else if (key === 'style') {
              setStyle(elem.style, value);
          } else if (key === 'dangerouslySetInnerHTML') {
              value && value.__html != null && (elem.innerHTML = value.__html);
          } else if (isCustomComponent) {
              if (value == null) {
                  elem.removeAttribute(key);
              } else {
                  elem.setAttribute(key, '' + value);
              }
          } else {
              setPropValue(elem, key, value);
          }
      }
  }

  function patchProp(key, oldValue, value, elem, isCustomComponent) {
      if (key === 'value' || key === 'checked') {
          oldValue = elem[key];
      }
      if (value === oldValue) {
          return;
      }
      if (value === undefined) {
          if (EVENT_KEYS.test(key)) {
              removeEvent(elem, key);
          } else if (key === 'style') {
              removeStyle(elem.style, oldValue);
          } else if (key === 'dangerouslySetInnerHTML') {
              elem.innerHTML = '';
          } else if (isCustomComponent) {
              elem.removeAttribute(key);
          } else {
              removePropValue(elem, key);
          }
          return;
      }
      if (EVENT_KEYS.test(key)) {
          // addEvent will replace the oldValue
          addEvent(elem, key, value);
      } else if (key === 'style') {
          patchStyle(elem.style, oldValue, value);
      } else if (key === 'dangerouslySetInnerHTML') {
          var oldHtml = oldValue && oldValue.__html;
          var html = value && value.__html;
          if (html != null && html !== oldHtml) {
              elem.innerHTML = html;
          }
      } else if (isCustomComponent) {
          if (value == null) {
              elem.removeAttribute(key);
          } else {
              elem.setAttribute(key, '' + value);
          }
      } else {
          setPropValue(elem, key, value);
      }
  }

  function patchProps(elem, props, newProps, isCustomComponent) {
      var keyMap = { children: true };
      for (var key in props) {
          if (props.hasOwnProperty(key) && key !== 'children') {
              keyMap[key] = true;
              patchProp(key, props[key], newProps[key], elem, isCustomComponent);
          }
      }
      for (var key in newProps) {
          if (newProps.hasOwnProperty(key) && keyMap[key] !== true) {
              patchProp(key, props[key], newProps[key], elem, isCustomComponent);
          }
      }
  }

  if (!Object.freeze) {
      Object.freeze = identity;
  }

  var pendingRendering = {};
  var vnodeStore = {};
  function renderTreeIntoContainer(vnode, container, callback, parentContext) {
  	if (!vnode.vtype) {
  		throw new Error('cannot render ' + vnode + ' to container');
  	}
  	var id = container[COMPONENT_ID] || (container[COMPONENT_ID] = getUid());
  	var argsCache = pendingRendering[id];

  	// component lify cycle method maybe call root rendering
  	// should bundle them and render by only one time
  	if (argsCache) {
  		if (argsCache === true) {
  			pendingRendering[id] = argsCache = [vnode, callback, parentContext];
  		} else {
  			argsCache[0] = vnode;
  			argsCache[2] = parentContext;
  			if (callback) {
  				argsCache[1] = argsCache[1] ? pipe(argsCache[1], callback) : callback;
  			}
  		}
  		return;
  	}

  	pendingRendering[id] = true;
  	var oldVnode = null;
  	var rootNode = null;
  	if (oldVnode = vnodeStore[id]) {
  		rootNode = compareTwoVnodes(oldVnode, vnode, container.firstChild, parentContext);
  	} else {
  		rootNode = initVnode(vnode, parentContext, container.namespaceURI);
  		var childNode = null;
  		while (childNode = container.lastChild) {
  			container.removeChild(childNode);
  		}
  		container.appendChild(rootNode);
  	}
  	vnodeStore[id] = vnode;
  	var isPending = updateQueue.isPending;
  	updateQueue.isPending = true;
  	clearPendingComponents();
  	argsCache = pendingRendering[id];
  	delete pendingRendering[id];

  	var result = null;
  	if (isArr(argsCache)) {
  		result = renderTreeIntoContainer(argsCache[0], container, argsCache[1], argsCache[2]);
  	} else if (vnode.vtype === VELEMENT) {
  		result = rootNode;
  	} else if (vnode.vtype === VCOMPONENT) {
  		result = rootNode.cache[vnode.id];
  	}

  	if (!isPending) {
  		updateQueue.isPending = false;
  		updateQueue.batchUpdate();
  	}

  	if (callback) {
  		callback.call(result);
  	}

  	return result;
  }

  function render(vnode, container, callback) {
  	return renderTreeIntoContainer(vnode, container, callback);
  }

  function unstable_renderSubtreeIntoContainer(parentComponent, subVnode, container, callback) {
  	var context = parentComponent.vnode ? parentComponent.vnode.context : parentComponent.$cache.parentContext;
  	return renderTreeIntoContainer(subVnode, container, callback, context);
  }

  function unmountComponentAtNode(container) {
  	if (!container.nodeName) {
  		throw new Error('expect node');
  	}
  	var id = container[COMPONENT_ID];
  	var vnode = null;
  	if (vnode = vnodeStore[id]) {
  		destroyVnode(vnode, container.firstChild);
  		container.removeChild(container.firstChild);
  		delete vnodeStore[id];
  		return true;
  	}
  	return false;
  }

  function findDOMNode(node) {
  	if (node == null) {
  		return null;
  	}
  	if (node.nodeName) {
  		return node;
  	}
  	var component = node;
  	// if component.node equal to false, component must be unmounted
  	if (component.getDOMNode && component.$cache.isMounted) {
  		return component.getDOMNode();
  	}
  	throw new Error('findDOMNode can not find Node');
  }

  var ReactDOM = Object.freeze({
  	render: render,
  	unstable_renderSubtreeIntoContainer: unstable_renderSubtreeIntoContainer,
  	unmountComponentAtNode: unmountComponentAtNode,
  	findDOMNode: findDOMNode
  });

  function isValidElement(obj) {
  	return obj != null && !!obj.vtype;
  }

  function cloneElement(originElem, props) {
  	var type = originElem.type;
  	var key = originElem.key;
  	var ref = originElem.ref;

  	var newProps = extend(extend({ key: key, ref: ref }, originElem.props), props);

  	for (var _len = arguments.length, children = Array(_len > 2 ? _len - 2 : 0), _key = 2; _key < _len; _key++) {
  		children[_key - 2] = arguments[_key];
  	}

  	var vnode = createElement.apply(undefined, [type, newProps].concat(children));
  	if (vnode.ref === originElem.ref) {
  		vnode.refs = originElem.refs;
  	}
  	return vnode;
  }

  function createFactory(type) {
  	var factory = function factory() {
  		for (var _len2 = arguments.length, args = Array(_len2), _key2 = 0; _key2 < _len2; _key2++) {
  			args[_key2] = arguments[_key2];
  		}

  		return createElement.apply(undefined, [type].concat(args));
  	};
  	factory.type = type;
  	return factory;
  }

  function createElement(type, props, children) {
  	var createVnode = null;
  	var varType = typeof type;

  	if (varType === 'string') {
  		createVnode = createVelem;
  	} else if (varType === 'function') {
  		if (type.prototype && typeof type.prototype.forceUpdate === 'function') {
  			createVnode = createVcomponent;
  		} else {
  			createVnode = createVstateless;
  		}
  	} else {
  		throw new Error('React.createElement: unexpect type [ ' + type + ' ]');
  	}

  	var key = null;
  	var ref = null;
  	var finalProps = {};
  	var propValue = null;
  	if (props != null) {
  		for (var propKey in props) {
  			if (!props.hasOwnProperty(propKey)) {
  				continue;
  			}
  			if (propKey === 'key') {
  				if (props.key !== undefined) {
  					key = '' + props.key;
  				}
  			} else if (propKey === 'ref') {
  				if (props.ref !== undefined) {
  					ref = props.ref;
  				}
  			} else if ((propValue = props[propKey]) !== undefined) {
  				finalProps[propKey] = propValue;
  			}
  		}
  	}

  	var defaultProps = type.defaultProps;

  	if (defaultProps) {
  		for (var propKey in defaultProps) {
  			if (finalProps[propKey] === undefined) {
  				finalProps[propKey] = defaultProps[propKey];
  			}
  		}
  	}

  	var argsLen = arguments.length;
  	var finalChildren = children;

  	if (argsLen > 3) {
  		finalChildren = Array(argsLen - 2);
  		for (var i = 2; i < argsLen; i++) {
  			finalChildren[i - 2] = arguments[i];
  		}
  	}

  	if (finalChildren !== undefined) {
  		finalProps.children = finalChildren;
  	}

  	var vnode = createVnode(type, finalProps);
  	vnode.key = key;
  	vnode.ref = ref;
  	return vnode;
  }

  var tagNames = 'a|abbr|address|area|article|aside|audio|b|base|bdi|bdo|big|blockquote|body|br|button|canvas|caption|cite|code|col|colgroup|data|datalist|dd|del|details|dfn|dialog|div|dl|dt|em|embed|fieldset|figcaption|figure|footer|form|h1|h2|h3|h4|h5|h6|head|header|hgroup|hr|html|i|iframe|img|input|ins|kbd|keygen|label|legend|li|link|main|map|mark|menu|menuitem|meta|meter|nav|noscript|object|ol|optgroup|option|output|p|param|picture|pre|progress|q|rp|rt|ruby|s|samp|script|section|select|small|source|span|strong|style|sub|summary|sup|table|tbody|td|textarea|tfoot|th|thead|time|title|tr|track|u|ul|var|video|wbr|circle|clipPath|defs|ellipse|g|image|line|linearGradient|mask|path|pattern|polygon|polyline|radialGradient|rect|stop|svg|text|tspan';
  var DOM = {};
  eachItem(tagNames.split('|'), function (tagName) {
  	DOM[tagName] = createFactory(tagName);
  });

  var check = function check() {
      return check;
  };
  check.isRequired = check;
  var PropTypes = {
      "array": check,
      "bool": check,
      "func": check,
      "number": check,
      "object": check,
      "string": check,
      "any": check,
      "arrayOf": check,
      "element": check,
      "instanceOf": check,
      "node": check,
      "objectOf": check,
      "oneOf": check,
      "oneOfType": check,
      "shape": check
  };

  function only(children) {
  	if (isValidElement(children)) {
  		return children;
  	}
  	throw new Error('expect only one child');
  }

  function forEach(children, iteratee, context) {
  	if (children == null) {
  		return children;
  	}
  	var index = 0;
  	if (isArr(children)) {
  		flattenChildren(children, function (child) {
  			iteratee.call(context, child, index++);
  		});
  	} else {
  		iteratee.call(context, children, index);
  	}
  }

  function map(children, iteratee, context) {
  	if (children == null) {
  		return children;
  	}
  	var store = [];
  	var keyMap = {};
  	forEach(children, function (child, index) {
  		var data = {};
  		data.child = iteratee.call(context, child, index) || child;
  		data.isEqual = data.child === child;
  		var key = data.key = getKey(child, index);
  		if (keyMap.hasOwnProperty(key)) {
  			keyMap[key] += 1;
  		} else {
  			keyMap[key] = 0;
  		}
  		data.index = keyMap[key];
  		store.push(data);
  	});
  	var result = [];
  	eachItem(store, function (_ref) {
  		var child = _ref.child;
  		var key = _ref.key;
  		var index = _ref.index;
  		var isEqual = _ref.isEqual;

  		if (child == null || typeof child === 'boolean') {
  			return;
  		}
  		if (!isValidElement(child) || key == null) {
  			result.push(child);
  			return;
  		}
  		if (keyMap[key] !== 0) {
  			key += ':' + index;
  		}
  		if (!isEqual) {
  			key = escapeUserProvidedKey(child.key || '') + '/' + key;
  		}
  		child = cloneElement(child, { key: key });
  		result.push(child);
  	});
  	return result;
  }

  function count(children) {
  	var count = 0;
  	forEach(children, function () {
  		count++;
  	});
  	return count;
  }

  function toArray(children) {
  	return map(children, identity) || [];
  }

  function getKey(child, index) {
  	var key = undefined;
  	if (isValidElement(child) && typeof child.key === 'string') {
  		key = '.$' + child.key;
  	} else {
  		key = '.' + index.toString(36);
  	}
  	return key;
  }

  var userProvidedKeyEscapeRegex = /\/(?!\/)/g;
  function escapeUserProvidedKey(text) {
  	return ('' + text).replace(userProvidedKeyEscapeRegex, '//');
  }

  var Children = Object.freeze({
  	only: only,
  	forEach: forEach,
  	map: map,
  	count: count,
  	toArray: toArray
  });

  function eachMixin(mixins, iteratee) {
  	eachItem(mixins, function (mixin) {
  		if (mixin) {
  			if (isArr(mixin.mixins)) {
  				eachMixin(mixin.mixins, iteratee);
  			}
  			iteratee(mixin);
  		}
  	});
  }

  function combineMixinToProto(proto, mixin) {
  	for (var key in mixin) {
  		if (!mixin.hasOwnProperty(key)) {
  			continue;
  		}
  		var value = mixin[key];
  		if (key === 'getInitialState') {
  			proto.$getInitialStates.push(value);
  			continue;
  		}
  		var curValue = proto[key];
  		if (isFn(curValue) && isFn(value)) {
  			proto[key] = pipe(curValue, value);
  		} else {
  			proto[key] = value;
  		}
  	}
  }

  function combineMixinToClass(Component, mixin) {
  	extend(Component.propTypes, mixin.propTypes);
  	extend(Component.contextTypes, mixin.contextTypes);
  	extend(Component, mixin.statics);
  	if (isFn(mixin.getDefaultProps)) {
  		extend(Component.defaultProps, mixin.getDefaultProps());
  	}
  }

  function bindContext(obj, source) {
  	for (var key in source) {
  		if (source.hasOwnProperty(key)) {
  			if (isFn(source[key])) {
  				obj[key] = source[key].bind(obj);
  			}
  		}
  	}
  }

  var Facade = function Facade() {};
  Facade.prototype = Component.prototype;

  function getInitialState() {
  	var _this = this;

  	var state = {};
  	var setState = this.setState;
  	this.setState = Facade;
  	eachItem(this.$getInitialStates, function (getInitialState) {
  		if (isFn(getInitialState)) {
  			extend(state, getInitialState.call(_this));
  		}
  	});
  	this.setState = setState;
  	return state;
  }
  function createClass(spec) {
  	if (!isFn(spec.render)) {
  		throw new Error('createClass: spec.render is not function');
  	}
  	var specMixins = spec.mixins || [];
  	var mixins = specMixins.concat(spec);
  	spec.mixins = null;
  	function Klass(props, context) {
  		Component.call(this, props, context);
  		this.constructor = Klass;
  		spec.autobind !== false && bindContext(this, Klass.prototype);
  		this.state = this.getInitialState() || this.state;
  	}
  	Klass.displayName = spec.displayName;
  	Klass.contextTypes = {};
  	Klass.propTypes = {};
  	Klass.defaultProps = {};
  	var proto = Klass.prototype = new Facade();
  	proto.$getInitialStates = [];
  	eachMixin(mixins, function (mixin) {
  		combineMixinToProto(proto, mixin);
  		combineMixinToClass(Klass, mixin);
  	});
  	proto.getInitialState = getInitialState;
  	spec.mixins = specMixins;
  	return Klass;
  }

  var React = extend({
      version: '0.15.1',
      cloneElement: cloneElement,
      isValidElement: isValidElement,
      createElement: createElement,
      createFactory: createFactory,
      Component: Component,
      createClass: createClass,
      Children: Children,
      PropTypes: PropTypes,
      DOM: DOM,
      __spread: extend
  }, ReactDOM);

  React.__SECRET_DOM_DO_NOT_USE_OR_YOU_WILL_BE_FIRED = ReactDOM;

  return React;

}));