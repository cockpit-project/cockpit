'use strict';

try { angular.module("kubernetesUI") } catch(e) { angular.module("kubernetesUI", []) }

angular.module('kubernetesUI')
.factory('KubernetesObjectDescriber', [function() {
  function KubernetesObjectDescriber() {
    this.kinds = {
      "Pod" : {
        templateUrl: "views/pod.html"
      },
      "Service" : {
        templateUrl: "views/service.html"
      },
      "ReplicationController" : {
        templateUrl: "views/replication-controller.html"
      }  
    };
  }

  KubernetesObjectDescriber.prototype.registerKind = function(kind, templateUrl, overwrite) {
    if (this.kinds[kind] && !overwrite) {
      throw "KubernetesObjectDescriber.registerKind :: kind " + kind + " is already registered."
    }
    if (!templateUrl) {
      throw "KubernetesObjectDescriber.registerKind :: templateUrl is required."
    }
    this.kinds[kind] = {
      templateUrl: templateUrl
    };
  };

  KubernetesObjectDescriber.prototype.templateUrlForKind = function(kind) {
    if (kind && this.kinds[kind]) {
      return this.kinds[kind].templateUrl;
    }
    return 'views/default-describer.html';
  };

  return new KubernetesObjectDescriber();
}])
.directive("kubernetesObjectDescriber", [
    "KubernetesObjectDescriber",
    "$templateCache",
    "$compile",
    function(KubernetesObjectDescriber, $templateCache, $compile) {
  return {
    restrict: 'E',
    scope: {
      resource: '=',
      kind: '@',
      moreDetailsLink: '@'
    },
    link: function(scope, element, attrs) {
      var compileTemplate = function() {
        // TODO test this for any potential XSS vulnerabilities
        var templateUrl = KubernetesObjectDescriber.templateUrlForKind(scope.kind);
        element.html($templateCache.get(templateUrl));
        $compile(element.contents())(scope);
      };

      // Initial template compilation based on the current kind
      compileTemplate();

      // Any time the kind changes, find the new template and compile it
      scope.$watch('kind', function(newValue, oldValue) {
        if (newValue != oldValue) {
          compileTemplate();
        }
      });
    }
  }
}])
.directive("kubernetesObjectDescribeLabels", function() {
  return {
    restrict: 'E',
    scope: {
      resource: '='
    },
    templateUrl: 'views/labels.html'
  }
})
.directive("kubernetesObjectDescribeAnnotations", function() {
  return {
    restrict: 'E',
    scope: {
      resource: '='
    },
    templateUrl: 'views/annotations.html'
  }
})
.directive("kubernetesObjectDescribeMetadata", function() {
  return {
    restrict: 'E',
    scope: {
      resource: '='
    },
    templateUrl: 'views/metadata.html'
  }
})
.directive("kubernetesObjectDescribeHeader", function() {
  return {
    restrict: 'E',
    scope: {
      resource: '=',
      kind: '='
    },
    templateUrl: 'views/header.html'
  }
})
.directive("kubernetesObjectDescribeFooter", function() {
  return {
    restrict: 'E',
    scope: {
      resource: '='
    },
    templateUrl: 'views/footer.html'
  }
})
.directive("kubernetesObjectDescribePodTemplate", function() {
  return {
    restrict: 'E',
    scope: {
      template: '='
    },
    templateUrl: 'views/pod-template.html'
  }
})
.directive("kubernetesObjectDescribeVolumes", function() {
  return {
    restrict: 'E',
    scope: {
      volumes: '='
    },
    templateUrl: 'views/volumes.html'
  }
})
.directive("kubernetesObjectDescribeContainers", function() {
  return {
    restrict: 'E',
    scope: {
      containers: '='
    },
    templateUrl: 'views/containers.html'
  }
})
.directive("kubernetesObjectDescribeContainerStatuses", function() {
  return {
    restrict: 'E',
    scope: {
      containerStatuses: '='
    },
    templateUrl: 'views/container-statuses.html'
  };
})
.directive("kubernetesObjectDescribeContainerState", function() {
  return {
    restrict: 'E',
    scope: {
      containerState: '='
    },
    templateUrl: 'views/container-state.html'
  };
})
.directive("collapseLongText", function() {
  return {
    restrict: 'A',
    scope: {
      value: '@',
      enableCollapse: '=?' // not intended to be passed in, it will be set depending on jquery availability
    },
    controller: ["$scope", function($scope) {
      // If jquery is available
      $scope.enableCollapse = !!window.$;
    }],
    link: function($scope, element, attrs) {
      if ($scope.enableCollapse) {
        $('.reveal-contents-link', element).click(function (evt) {
          $(this).hide();
          $('.reveal-contents', element).show();
        });  
      }
    },    
    templateUrl: 'views/_collapse-long-text.html'
  }
})
.filter("isEmptyObj", function() {
  return function(obj) {
    return angular.equals({}, obj);
  };
});

angular.module('kubernetesUI').run(['$templateCache', function($templateCache) {
  'use strict';

  $templateCache.put('views/_collapse-long-text.html',
    "<span ng-hide=\"enableCollapse && value.length > 120\">{{value}}</span>\n" +
    "<span ng-show=\"enableCollapse && value.length > 120\">\n" +
    "  <span class=\"reveal-contents-link\" style=\"cursor: pointer;\" title=\"Expand\">{{value.substring(0, 120)}}<a href=\"javascript:;\">...</a></span>\n" +
    "  <span style=\"display: none;\" class=\"reveal-contents\">{{value}}</span>\n" +
    "</span>"
  );


  $templateCache.put('views/annotations.html',
    "  <h3>Annotations</h3>\n" +
    "  <span ng-if=\"!resource.metadata.annotations\"><em>none</em></span>\n" +
    "  <dl class=\"dl-horizontal\" ng-if=\"resource.metadata.annotations\">\n" +
    "    <dt ng-repeat-start=\"(annotationKey, annotationValue) in resource.metadata.annotations\" title=\"{{annotationKey}}\">{{annotationKey}}</dt>\n" +
    "    <dd ng-repeat-end collapse-long-text value=\"{{annotationValue}}\"></dd>\n" +
    "  </dl>"
  );


  $templateCache.put('views/container-state.html',
    "<span ng-if=\"containerState | isEmptyObj\"><em>none</em></span>\n" +
    "<span ng-repeat=\"(state, stateDescription) in containerState | limitTo: 1\">\n" +
    "  <span ng-switch=\"state\">\n" +
    "    <span ng-switch-when=\"waiting\">\n" +
    "      Waiting\n" +
    "      <span ng-if=\"stateDescription.reason\">({{stateDescription.reason}})</span>\n" +
    "    </span>\n" +
    "    <span ng-switch-when=\"running\">\n" +
    "      Running\n" +
    "      <span ng-if=\"stateDescription.startedAt\">since {{stateDescription.startedAt | date:'medium'}}</span>\n" +
    "    </span>\n" +
    "    <span ng-switch-when=\"terminated\">\n" +
    "      Terminated\n" +
    "      <span ng-if=\"stateDescription.finishedAt\">at {{stateDescription.finishedAt | date:'medium'}}</span>\n" +
    "      <span ng-if=\"stateDescription.exitCode\">with exit code {{stateDescription.exitCode}}</span>\n" +
    "      <span ng-if=\"stateDescription.reason\">({{stateDescription.reason}})</span>\n" +
    "    </span>\n" +
    "    <span ng-switch-default>{{state}}</span>\n" +
    "  </span>\n" +
    "</span>\n"
  );


  $templateCache.put('views/container-statuses.html',
    "<div ng-if=\"!containerStatuses\"><em>none</em></div>\n" +
    "<dl ng-repeat=\"containerStatus in containerStatuses | orderBy:'name'\" class=\"dl-horizontal\">\n" +
    "  <dt>Name</dt>\n" +
    "  <dd>{{containerStatus.name}}</dd>\n" +
    "  <dt>State</dt>\n" +
    "  <dd>\n" +
    "    <kubernetes-object-describe-container-state container-state=\"containerStatus.state\"></container-state>\n" +
    "  </dd>\n" +
    "  <dt ng-if=\"!(containerStatus.lastState | isEmptyObj)\">Last State</dt>\n" +
    "  <dd ng-if=\"!(containerStatus.lastState | isEmptyObj)\">\n" +
    "    <kubernetes-object-describe-container-state container-state=\"containerStatus.lastState\"></container-state>\n" +
    "  </dd>\n" +
    "  <dt>Ready</dt>\n" +
    "  <dd>{{containerStatus.ready}}</dd>\n" +
    "  <dt>Restart Count</dt>\n" +
    "  <dd>{{containerStatus.restartCount}}</dd>\n" +
    "</dl>\n"
  );


  $templateCache.put('views/containers.html',
    "<div ng-if=\"!containers.length\"><em>none</em></div>\n" +
    "<dl class=\"dl-horizontal\" ng-repeat=\"container in containers\">\n" +
    "<dt>Name</dt>\n" +
    "<dd>{{container.name}}</dd>\n" +
    "<dt>Image</dt>\n" +
    "<dd ng-if=\"container.image\">{{container.image}}</dd>\n" +
    "<dd ng-if=\"!container.image\"><em>none</em></dd>\n" +
    "<dt>Ports</dt>\n" +
    "<dd>\n" +
    "  <div ng-if=\"!container.ports.length\"><em>none</em></div>\n" +
    "  <div ng-repeat=\"port in container.ports | orderBy:'containerPort'\">\n" +
    "    {{port.containerPort}}/{{port.protocol}}<span ng-if=\"port.hostPort\"> to host port {{port.hostPort}}</span>\n" +
    "  </div>\n" +
    "</dd>\n" +
    "<dt>Env vars</dt>\n" +
    "<dd>\n" +
    "  <div ng-if=\"!container.env.length\"><em>none</em></div>\n" +
    "  <div ng-repeat=\"env in container.env | orderBy:'name'\" collapse-long-text value=\"{{env.name}}={{env.value}}\"></div>\n" +
    "</dd>\n" +
    "</dl>\n" +
    "<div ng-if=\"$index != 0\" style=\"margin-bottom: 10px;\"></div>\n"
  );


  $templateCache.put('views/default-describer.html',
    "<div>\n" +
    "  <kubernetes-object-describe-header resource=\"resource\" kind=\"kind\"></kubernetes-object-describe-header>\n" +
    "  <kubernetes-object-describe-metadata resource=\"resource\"></kubernetes-object-describe-metadata>\n" +
    "  <kubernetes-object-describe-footer resource=\"resource\"></kubernetes-object-describe-footer>\n" +
    "</div>"
  );


  $templateCache.put('views/footer.html',
    "<div style=\"margin-top: 10px;\">\n" +
    "  <a ng-if=\"moreDetailsLink\" href=\"{{moreDetailsLink}}\">More details...</a>  \n" +
    "</div>"
  );


  $templateCache.put('views/header.html',
    "<h3>{{kind || resource.kind || 'Resource'}}</h3>"
  );


  $templateCache.put('views/labels.html',
    "<h3>Labels</h3>\n" +
    "<span ng-if=\"!resource.metadata.labels\"><em>none</em></span>\n" +
    "<dl class=\"dl-horizontal\" ng-if=\"resource.metadata.labels\">\n" +
    "  <dt ng-repeat-start=\"(labelKey, labelValue) in resource.metadata.labels\" title=\"{{labelKey}}\">{{labelKey}}</dt>\n" +
    "  <dd ng-repeat-end>{{labelValue}}</dd>\n" +
    "</dl>"
  );


  $templateCache.put('views/metadata.html',
    "<dl class=\"dl-horizontal\">\n" +
    "  <dt>Name</dt>\n" +
    "  <dd>{{resource.metadata.name}}</dd>\n" +
    "  <dt ng-if=\"resource.metadata.namespace\">Namespace</dt>\n" +
    "  <dd ng-if=\"resource.metadata.namespace\">{{resource.metadata.namespace}}</dd>\n" +
    "  <dt>Created</dt>\n" +
    "  <dd>{{resource.metadata.creationTimestamp | date:'medium'}}</dd>    \n" +
    "</dl>\n" +
    "<kubernetes-object-describe-labels resource=\"resource\"></kubernetes-object-describe-labels>\n" +
    "<kubernetes-object-describe-annotations resource=\"resource\"></kubernetes-object-describe-annotations>\n"
  );


  $templateCache.put('views/pod-template.html',
    "<h3>Pod Template</h3>\n" +
    "<dl class=\"dl-horizontal\">\n" +
    "  <dt>Restart policy</dt>\n" +
    "  <dd>{{template.restartPolicy}}</dd>\n" +
    "  <dt>DNS policy</dt>\n" +
    "  <dd>{{template.dnsPolicy}}</dd>\n" +
    "  <dt ng-if=\"template.serviceAccountName\">Service account</dt>\n" +
    "  <dd ng-if=\"template.serviceAccountName\">{{template.serviceAccountName}}</dd>\n" +
    "</dl>  \n" +
    "<h4>Containers</h4>\n" +
    "<kubernetes-object-describe-containers containers=\"template.containers\"></kubernetes-object-describe-containers>\n" +
    "<h4>Volumes</h4>\n" +
    "<kubernetes-object-describe-volumes volumes=\"template.volumes\"></kubernetes-object-describe-volumes> \n"
  );


  $templateCache.put('views/pod.html',
    "<div>\n" +
    "  <kubernetes-object-describe-header resource=\"resource\" kind=\"kind\"></kubernetes-object-describe-header>\n" +
    "  <dl class=\"dl-horizontal\">\n" +
    "    <dt>Name</dt>\n" +
    "    <dd>{{resource.metadata.name}}</dd>\n" +
    "    <dt>Namespace</dt>\n" +
    "    <dd>{{resource.metadata.namespace}}</dd>\n" +
    "    <dt>Created</dt>\n" +
    "    <dd>{{resource.metadata.creationTimestamp | date:'medium'}}</dd>\n" +
    "    <dt>Restart policy</dt>\n" +
    "    <dd>{{resource.spec.restartPolicy || 'Always'}}</dd>\n" +
    "    <dt ng-if=\"resource.spec.serviceAccountName\">Service account</dt>\n" +
    "    <dd ng-if=\"resource.spec.serviceAccountName\">{{resource.spec.serviceAccountName}}</dd>\n" +
    "  </dl>\n" +
    "  <h3>Status</h3>\n" +
    "  <dl class=\"dl-horizontal\">\n" +
    "    <dt>Phase</dt>\n" +
    "    <dd>{{resource.status.phase}}</dd>\n" +
    "    <dt>Node</dt>\n" +
    "    <dd>{{resource.spec.nodeName || 'unknown'}}\n" +
    "      <span ng-if=\"resource.status.hostIP && resource.spec.nodeName != resource.status.hostIP\">({{resource.status.hostIP}})</span></dd>\n" +
    "    <dt>IP on node</dt>\n" +
    "    <dd>\n" +
    "      {{resource.status.podIP}}\n" +
    "      <span ng-if=\"!resource.status.podIP\"><em>none</em></span>\n" +
    "    </dd>\n" +
    "  </dl>\n" +
    "  <h3>Container Statuses</h3>\n" +
    "  <kubernetes-object-describe-container-statuses container-statuses=\"resource.status.containerStatuses\"></kubernetes-object-describe-container-statuses>\n" +
    "  <h3>Containers</h3>\n" +
    "  <kubernetes-object-describe-containers containers=\"resource.spec.containers\"></kubernetes-object-describe-containers>\n" +
    "  <h3>Volumes</h3>\n" +
    "  <kubernetes-object-describe-volumes volumes=\"resource.spec.volumes\"></kubernetes-object-describe-volumes>\n" +
    "  <kubernetes-object-describe-labels resource=\"resource\"></kubernetes-object-describe-labels>\n" +
    "  <kubernetes-object-describe-annotations resource=\"resource\"></kubernetes-object-describe-annotations>\n" +
    "  <kubernetes-object-describe-footer resource=\"resource\"></kubernetes-object-describe-footer>\n" +
    "</div>\n"
  );


  $templateCache.put('views/replication-controller.html',
    "<div>\n" +
    "  <kubernetes-object-describe-header resource=\"resource\" kind=\"kind\"></kubernetes-object-describe-header>\n" +
    "  <dl class=\"dl-horizontal\">\n" +
    "    <dt>Name</dt>\n" +
    "    <dd>{{resource.metadata.name}}</dd>\n" +
    "    <dt>Namespace</dt>\n" +
    "    <dd>{{resource.metadata.namespace}}</dd>\n" +
    "    <dt>Created</dt>\n" +
    "    <dd>{{resource.metadata.creationTimestamp | date:'medium'}}</dd>\n" +
    "    <dt>Replicas</dt>\n" +
    "    <dd>{{(resource.spec.replicas === undefined) ? 1 : resource.spec.replicas}}</dd>\n" +
    "  </dl>\n" +
    "  <h3>Selector</h3>\n" +
    "  <dl class=\"dl-horizontal\">\n" +
    "    <dt ng-repeat-start=\"(selectorKey, selectorValue) in resource.spec.selector\" title=\"{{selectorKey}}\">{{selectorKey}}</dt>\n" +
    "    <dd ng-repeat-end>{{selectorValue}}</dd>\n" +
    "  </dl>\n" +
    "  <kubernetes-object-describe-pod-template template=\"resource.spec.template.spec\"></kubernetes-object-describe-pod-template>\n" +
    "  <kubernetes-object-describe-labels resource=\"resource\"></kubernetes-object-describe-labels>\n" +
    "  <kubernetes-object-describe-annotations resource=\"resource\"></kubernetes-object-describe-annotations>\n" +
    "  <kubernetes-object-describe-footer resource=\"resource\"></kubernetes-object-describe-footer>\n" +
    "</div>\n"
  );


  $templateCache.put('views/service.html',
    "<div>\n" +
    "  <kubernetes-object-describe-header resource=\"resource\" kind=\"kind\"></kubernetes-object-describe-header>\n" +
    "  <dl class=\"dl-horizontal\">\n" +
    "    <dt>Name</dt>\n" +
    "    <dd>{{resource.metadata.name}}</dd>\n" +
    "    <dt>Namespace</dt>\n" +
    "    <dd>{{resource.metadata.namespace}}</dd>\n" +
    "    <dt>Created</dt>\n" +
    "    <dd>{{resource.metadata.creationTimestamp | date:'medium'}}</dd>\n" +
    "    <dt>Type</dt>\n" +
    "    <dd>{{resource.spec.type}}</dd>\n" +
    "    <dt>IP</dt>\n" +
    "    <dd>{{resource.spec.clusterIP}}</dd>\n" +
    "    <dt>Ports</dt>\n" +
    "    <dd>\n" +
    "      <div ng-if=\"!resource.spec.ports.length\">None</div>\n" +
    "      <div ng-repeat=\"portMapping in resource.spec.ports | orderBy:'port'\">\n" +
    "        {{portMapping.port}} &#8594; {{portMapping.targetPort}} ({{portMapping.protocol}})\n" +
    "      </div>\n" +
    "    </dd>\n" +
    "    <dt>Session affinity</dt>\n" +
    "    <dd>{{resource.spec.sessionAffinity}}</dd>    \n" +
    "    <dt ng-if=\"resource.status.loadBalancer.ingress.length\">Ingress points</dt>\n" +
    "    <dd ng-if=\"resource.status.loadBalancer.ingress.length\">\n" +
    "      <span ng-repeat=\"ingress in resource.status.loadBalancer.ingress\"\n" +
    "        >{{ingress.ip}}<span ng-if=\"!$last\">, </span></span>\n" +
    "    </dd>\n" +
    "  </dl>\n" +
    "  <h3>Selector</h3>\n" +
    "  <dl class=\"dl-horizontal\">\n" +
    "    <dt ng-repeat-start=\"(selectorKey, selectorValue) in resource.spec.selector\">{{selectorKey}}</dt>\n" +
    "    <dd ng-repeat-end>{{selectorValue}}</dd>\n" +
    "  </dl>\n" +
    "  <kubernetes-object-describe-labels resource=\"resource\"></kubernetes-object-describe-labels>\n" +
    "  <kubernetes-object-describe-annotations resource=\"resource\"></kubernetes-object-describe-annotations>\n" +
    "  <kubernetes-object-describe-footer resource=\"resource\"></kubernetes-object-describe-footer>\n" +
    "</div>\n"
  );


  $templateCache.put('views/volumes.html',
    "<div ng-if=\"!volumes.length\"><em>none</em></div>\n" +
    "<dl class=\"dl-horizontal\" ng-repeat=\"volume in volumes\">\n" +
    "<dt>Name</dt>\n" +
    "<dd>{{volume.name}}</dd>\n" +
    "<!-- Type = host path -->\n" +
    "<dt ng-if-start=\"volume.hostPath\">Type</dt>\n" +
    "<dd>host path</dd>\n" +
    "<dt>Path</dt>\n" +
    "<dd ng-if-end>{{volume.hostPath.path}}</dd>\n" +
    "<!-- Type = empty dir -->\n" +
    "<dt ng-if-start=\"volume.emptyDir\">Type</dt>\n" +
    "<dd ng-if-end>empty directory</dd>\n" +
    "<!-- Type = GCE persistent disk - TODO fill out details -->\n" +
    "<dt ng-if-start=\"volume.gcePersistentDisk\">Type</dt>\n" +
    "<dd ng-if-end>GCE persistent disk</dd>\n" +
    "<!-- Type = git repo -->\n" +
    "<dt ng-if-start=\"volume.gitRepo\">Type</dt>\n" +
    "<dd>Git repository</dd>\n" +
    "<dt>Repository</dt>\n" +
    "<dd>{{volume.gitRepo.repository}}</dd>\n" +
    "<dt>Revision</dt>\n" +
    "<dd ng-if-end>\n" +
    "  <span ng-if=\"volume.gitRepo.revision\">{{volume.gitRepo.revision}}</span>\n" +
    "  <span ng-if=\"!volume.gitRepo.revision\"><em>not specified</em></span>\n" +
    "</dd>\n" +
    "</dl>"
  );

}]);
