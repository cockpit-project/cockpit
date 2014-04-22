/*
A simple jQuery function that can add listeners on attribute change.
http://meetselva.github.io/attrchange/

About License:
Copyright (C) 2013 Selvakumar Arumugam
You may use attrchange plugin under the terms of the MIT Licese.
https://github.com/meetselva/attrchange/blob/master/MIT-License.txt
*/
(function($) {
   function isDOMAttrModifiedSupported() {
		var p = document.createElement('p');
		var flag = false;

		if (p.addEventListener) p.addEventListener('DOMAttrModified', function() {
			flag = true;
		}, false);
		else if (p.attachEvent) p.attachEvent('onDOMAttrModified', function() {
			flag = true;
		});
		else return false;

		p.setAttribute('id', 'target');

		return flag;
   }

   function checkAttributes(chkAttr, e) {
		if (chkAttr) {
			var attributes = this.data('attr-old-value');

			if (e.attributeName.indexOf('style') >= 0) {
				if (!attributes['style']) attributes['style'] = {}; //initialize
				var keys = e.attributeName.split('.');
				e.attributeName = keys[0];
				e.oldValue = attributes['style'][keys[1]]; //old value
				e.newValue = keys[1] + ':' + this.prop("style")[$.camelCase(keys[1])]; //new value
				attributes['style'][keys[1]] = e.newValue;
			} else {
				e.oldValue = attributes[e.attributeName];
				e.newValue = this.attr(e.attributeName);
				attributes[e.attributeName] = e.newValue;
			}

			this.data('attr-old-value', attributes); //update the old value object
		}
   }

   //initialize Mutation Observer
   var MutationObserver = window.MutationObserver || window.WebKitMutationObserver;

   $.fn.attrchange = function(o) {

		var cfg = {
			trackValues: false,
			callback: $.noop
		};

		//for backward compatibility
		if (typeof o === "function" ) {
			cfg.callback = o;
		} else {
			$.extend(cfg, o);
		}

	    if (cfg.trackValues) { //get attributes old value
		$(this).each(function (unused, el) {
			var attributes = {};
			for (var attr, i=0, attrs=el.attributes, l=attrs.length; i<l; i++){
			    attr = attrs.item(i);
			    attributes[attr.nodeName] = attr.value;
			}

			$(this).data('attr-old-value', attributes);
		});
	    }

		if (MutationObserver) { //Modern Browsers supporting MutationObserver
			/*
			   Mutation Observer is still new and not supported by all browsers.
			   http://lists.w3.org/Archives/Public/public-webapps/2011JulSep/1622.html
			*/
			var mOptions = {
				subtree: false,
				attributes: true,
				attributeOldValue: cfg.trackValues
			};

			var observer = new MutationObserver(function(mutations) {
				mutations.forEach(function(e) {
					var _this = e.target;

					//get new value if trackValues is true
					if (cfg.trackValues) {
						/**
						 * @KNOWN_ISSUE: The new value is buggy for STYLE attribute as we don't have
						 * any additional information on which style is getting updated.
						 * */
						e.newValue = $(_this).attr(e.attributeName);
					}

					cfg.callback.call(_this, e);
				});
			});

			return this.each(function() {
				observer.observe(this, mOptions);
			});
		} else if (isDOMAttrModifiedSupported()) { //Opera
			//Good old Mutation Events but the performance is no good
			//http://hacks.mozilla.org/2012/05/dom-mutationobserver-reacting-to-dom-changes-without-killing-browser-performance/
			return this.on('DOMAttrModified', function(event) {
				if (event.originalEvent) event = event.originalEvent; //jQuery normalization is not required for us
				event.attributeName = event.attrName; //property names to be consistent with MutationObserver
				event.oldValue = event.prevValue; //property names to be consistent with MutationObserver
				cfg.callback.call(this, event);
			});
		} else if ('onpropertychange' in document.body) { //works only in IE
			return this.on('propertychange', function(e) {
				e.attributeName = window.event.propertyName;
				//to set the attr old value
				checkAttributes.call($(this), cfg.trackValues , e);
				cfg.callback.call(this, e);
			});
		}

		return this;
    };
})(jQuery);
