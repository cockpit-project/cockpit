require 'asciidoctor/extensions' unless RUBY_ENGINE == 'opal'

include Asciidoctor

# An inline macro that generates links to related man pages.
# For HTML it only generates links to Cockpit man pages as that is what
# is compiled. But you are able to use man:systemd[1], but it just
# won't get a link.
#
# Usage:
#
#   man:gittutorial[7]
#
class ManInlineMacro < Extensions::InlineMacroProcessor
  use_dsl

  named :man
  name_positional_attributes 'volnum'

  def process parent, target, attrs
    text = manname = target
    suffix = ''
    volnum = attrs['volnum']
    target = %(#{manname}.#{volnum}.html)
    suffix = %((#{volnum}))
    if parent.document.basebackend?('html') && manname.start_with?('cockpit')
      parent.document.register :links, target
      node = create_anchor parent, text, type: :link, target: target
    elsif parent.document.backend == 'manpage'
      node = create_inline parent, :quoted, manname, type: :strong
    else
      node = create_inline parent, :quoted, manname
    end
    suffix ? (create_inline parent, :quoted, %(#{node.convert}#{suffix})) : node
  end
end

Asciidoctor::Extensions.register do
  inline_macro ManInlineMacro
end
