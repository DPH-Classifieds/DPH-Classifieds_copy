from unittest.mock import MagicMock

import pytest

from services.url_safety import (
    SAFE_POST_REDIRECT_STATUSES,
    ResponseTooLarge,
    read_bounded_response,
    request_with_safe_redirects,
)


def _response(status, location=None, body=b""):
    response = MagicMock(status_code=status)
    response.headers = {"Location": location} if location else {}
    response.iter_content.return_value = [body] if body else []
    return response


def test_redirect_to_private_target_is_rejected_before_second_request():
    request_func = MagicMock(return_value=_response(302, "http://127.0.0.1/admin"))
    with pytest.raises(ValueError, match="private or reserved"):
        request_with_safe_redirects(request_func, "https://source.test/feed")
    request_func.assert_called_once()
    request_func.return_value.close.assert_called_once()


def test_same_origin_redirect_is_revalidated_and_followed():
    first = _response(302, "/next")
    second = _response(200, body=b"[]")
    request_func = MagicMock(side_effect=[first, second])
    assert request_with_safe_redirects(request_func, "https://source.test/feed") is second
    assert request_func.call_count == 2
    assert request_func.call_args_list[1].args[0] == "https://source.test/next"


def test_post_does_not_follow_method_changing_redirect():
    redirect = _response(302, "/other")
    request_func = MagicMock(return_value=redirect)
    assert request_with_safe_redirects(
        request_func,
        "https://hook.test/start",
        redirect_statuses=SAFE_POST_REDIRECT_STATUSES,
    ) is redirect
    request_func.assert_called_once()


def test_bounded_reader_rejects_stream_without_content_length():
    response = _response(200)
    response.iter_content.return_value = [b"1234", b"5678"]
    with pytest.raises(ResponseTooLarge):
        read_bounded_response(response, 5)
