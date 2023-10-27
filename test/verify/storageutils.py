def card(title):
    return f"[data-test-card-title='{title}']"

def card_row(title, index=None, name=None, location=None):
    if index is not None:
        return card(title) + f" tr:nth-child({index})"
    elif name is not None:
        return card(title) + f" [data-test-row-name='{name}']"
    else:
        return card(title) + f" [data-test-row-location='{location}']"

def card_row_col(title, row_index, col_index):
    return card_row(title, row_index) + f" td:nth-child({col_index})"

def card_desc(card_title, desc_title):
    return card(card_title) + f" [data-test-desc-title='{desc_title}'] dd"
